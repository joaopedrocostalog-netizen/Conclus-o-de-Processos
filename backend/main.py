import json, os, re
import fitz
import httpx
import pytesseract
from PIL import Image
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app=FastAPI(title='Conclusão de Processos API',version='1.1.1')
app.add_middleware(CORSMiddleware,allow_origins=['*'],allow_methods=['*'],allow_headers=['*'])
MAX_MB=int(os.getenv('MAX_UPLOAD_MB','25'))
FIELDS=['cliente','tipo_documento','operacao_transporte','servico_terminal','remetente','local_coleta','agencia_maritima','despachante','ref_despachante','numero_bl_awb','observacao','mostrar_vias','rota','local_armazenagem','data_faturamento','data_encerramento','ref_cliente','numero_documento','produto','produto_quimico','destinatario','local_entrega','navio','numero_viagem_navio','porto_origem','operacao_maritima','processo_faturado','faturamento_iniciado']
LABELS={'cliente':'Cliente','tipo_documento':'Tipo Documento','operacao_transporte':'Operação de Transporte','servico_terminal':'Serviço de Terminal?','remetente':'Remetente','local_coleta':'Local de Coleta','agencia_maritima':'Agência Marítima','despachante':'Despachante','ref_despachante':'Ref. Despachante','numero_bl_awb':'Nº BL / AWB','observacao':'Observação','mostrar_vias':'Mostrar Vias?','rota':'Rota','local_armazenagem':'Local de Armazenagem','data_faturamento':'Data para Faturamento','data_encerramento':'Data de Encerramento','ref_cliente':'Ref. do Cliente','numero_documento':'Nº Documento','produto':'Produto','produto_quimico':'Produto químico?','destinatario':'Destinatário','local_entrega':'Local de Entrega','navio':'Navio','numero_viagem_navio':'Nº Viagem Navio','porto_origem':'Porto de Origem','operacao_maritima':'Operação Marítima','processo_faturado':'Processo Faturado','faturamento_iniciado':'Faturamento Iniciado'}
PROMPT='''Você é um extrator documental de logística. Analise TODAS as páginas. Retorne JSON válido. Identifique IMPORTAÇÃO, EXPORTAÇÃO ou NÃO IDENTIFICADO somente por evidências. Nunca invente: ausência=null. Checkbox true/false somente com evidência clara; caso contrário null. Cada campo deve ter value, confidence (high/medium/low), page e source. Se houver conflito, coloque o campo como null e descreva em conflicts com as páginas. Para NF-e/DANFE, reconheça emitente como remetente quando apropriado, destinatário, número da NF-e, data de emissão, referência do importador, BL e DUIMP. Não transforme uma descrição de produto em cliente. Para produto, quando houver vários itens, retorne um resumo fiel com os códigos e descrições principais, sem inventar.'''+ ' Campos: '+','.join(FIELDS)

def extract_pages(raw):
    doc=fitz.open(stream=raw,filetype='pdf'); pages=[]
    for i,page in enumerate(doc,1):
        text=page.get_text('text').strip()
        if len(text)<20:
            try:
                pix=page.get_pixmap(matrix=fitz.Matrix(1.7,1.7),alpha=False)
                img=Image.frombytes('RGB',[pix.width,pix.height],pix.samples)
                text=pytesseract.image_to_string(img,lang='por+eng').strip()
            except Exception: pass
        pages.append({'page':i,'text':text})
    return pages

def classify(text):
    t=text.lower(); imp=sum(x in t for x in ['duimp','declaração única de importação','importação','importador','ref.importador','ref. importador']); exp=sum(x in t for x in ['exportação','exportador','booking','porto de destino'])
    return 'IMPORTAÇÃO' if imp>exp and imp else 'EXPORTAÇÃO' if exp>imp and exp else 'NÃO IDENTIFICADO'

def first_match(patterns,text):
    for pattern in patterns:
        m=re.search(pattern,text,re.I|re.M)
        if m and m.group(1): return m.group(1).strip()
    return None

def fallback_result(pages):
    fields=[]; full='\n'.join(p['text'] for p in pages); op=classify(full)
    patterns={
      'cliente':[r'\n(MOBIS BRASIL FABRICAÇÃO DE AUTO PEÇAS LTDA)\n(?:Rua|Av\.)',r'(?i)^([^\n]+?)\s*\n(?:Rua|Av\.|Avenida)'],
      'tipo_documento':[r'\b(NF-e|DANFE|DUIMP|DI|DUE)\b'],
      'numero_documento':[r'\bDUIMP\s+([0-9]{2}[A-Z]{2}[0-9]+-[0-9])',r'\bN[ºo]\s*[:\-]?\s*(\d{5,})\b'],
      'numero_bl_awb':[r'\bBL:\s*([A-Z0-9]{6,})',r'\bBL\s*[:\-]?\s*([A-Z0-9]{6,})',r'\bB/L\s*[:\-]?\s*([A-Z0-9]{6,})'],
      'ref_cliente':[r'REF\.?\s*IMPORTADOR\s*:\s*([A-Z0-9/.-]+)'],
      'destinatario':[r'DESTINATÁRIO\s*/\s*REMETENTE.*?\n([^\n]+?)\s+\d{2}/\d{2}/\d{4}'],
      'remetente':[r'\n(MOBIS BRASIL FABRICAÇÃO DE AUTO PEÇAS LTDA)\nRua\s+']
    }
    for key in FIELDS:
        value=page=None
        if key in patterns:
            for p in pages:
                v=first_match(patterns[key],p['text'])
                if v: value=v; page=p['page']; break
        if key=='tipo_documento' and not value and ('DANFE' in full or 'NF-e' in full): value='NF-e / DANFE'; page=1
        if key=='operacao_maritima' and op!='NÃO IDENTIFICADO': value='Importação' if op=='IMPORTAÇÃO' else 'Exportação'; page=1
        if key=='produto':
            items=[]
            for m in re.finditer(r'\b(\d{5,}[A-Z0-9]*)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9 ,.-]{8,})\n',full,re.I):
                desc=' '.join(m.group(2).split())
                if desc and desc.upper() not in {'DADOS DO PRODUTO / SERVIÇO'}: items.append(f'{m.group(1)} — {desc}')
            if items: value='; '.join(dict.fromkeys(items))[:1800]; page=1
        fields.append({'key':key,'label':LABELS[key],'value':value,'confidence':'medium' if value else 'low','page':page,'source':f'Página {page}' if page else 'Não localizado no PDF'})
    return {'process_type':op,'fields':fields,'conflicts':[],'pages':len(pages)}

async def ai_result(pages):
    key,url,model=os.getenv('AI_API_KEY'),os.getenv('AI_API_URL'),os.getenv('AI_MODEL','gpt-4o-mini')
    if not key or not url:return None
    content='\n\n'.join(f'--- PÁGINA {p["page"]} ---\n{p["text"]}' for p in pages)
    body={'model':model,'temperature':0,'messages':[{'role':'system','content':PROMPT},{'role':'user','content':content}],'response_format':{'type':'json_object'}}
    async with httpx.AsyncClient(timeout=90) as client:
        r=await client.post(url,headers={'Authorization':f'Bearer {key}'},json=body); r.raise_for_status(); return json.loads(r.json()['choices'][0]['message']['content'])

def normalize(data,pages):
    op=data.get('process_type',data.get('tipo_processo','NÃO IDENTIFICADO')); op=op if op in ['IMPORTAÇÃO','EXPORTAÇÃO','NÃO IDENTIFICADO'] else classify('\n'.join(p['text'] for p in pages)); raw=data.get('fields',data.get('campos',{})); fields=[]
    for key in FIELDS:
        item=raw.get(key) if isinstance(raw,dict) else None
        if isinstance(item,dict): value=item.get('value'); conf=item.get('confidence','medium'); page=item.get('page'); source=item.get('source') or (f'Página {page}' if page else 'Não informado no PDF')
        else: value=item; conf='medium' if value is not None else 'low'; page=None; source='Origem não informada'
        if value=='': value=None; conf='low'
        fields.append({'key':key,'label':LABELS[key],'value':value,'confidence':conf if conf in ['high','medium','low'] else 'low','page':page,'source':source})
    return {'process_type':op,'fields':fields,'conflicts':data.get('conflicts',[]),'pages':len(pages)}

@app.get('/api/health')
async def health(): return {'status':'ok','version':'1.1.1'}

@app.post('/api/analyze')
async def analyze(file:UploadFile=File(...)):
    if file.content_type!='application/pdf' and not (file.filename or '').lower().endswith('.pdf'): raise HTTPException(400,'Somente PDF é aceito.')
    raw=await file.read()
    if len(raw)>MAX_MB*1024*1024: raise HTTPException(413,f'Arquivo excede {MAX_MB} MB.')
    try: pages=extract_pages(raw)
    except Exception as exc: raise HTTPException(422,f'Não foi possível ler o PDF: {exc}')
    if not pages: raise HTTPException(422,'PDF sem páginas legíveis.')
    try:
        ai=await ai_result(pages)
        data=normalize(ai,pages) if ai else fallback_result(pages)
    except Exception:
        data=fallback_result(pages)
    data['filename']=file.filename or 'documento.pdf'; return data
