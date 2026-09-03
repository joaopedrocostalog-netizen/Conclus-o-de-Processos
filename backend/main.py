import json, os, re
from typing import Any
import fitz
import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title='Conclusão de Processos API', version='1.0.0')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])
MAX_MB = int(os.getenv('MAX_UPLOAD_MB', '25'))

FIELDS = ['cliente','tipo_documento','operacao_transporte','servico_terminal','remetente','local_coleta','agencia_maritima','despachante','ref_despachante','numero_bl_awb','observacao','mostrar_vias','rota','local_armazenagem','data_faturamento','data_encerramento','ref_cliente','numero_documento','produto','produto_quimico','destinatario','local_entrega','navio','numero_viagem_navio','porto_origem','operacao_maritima','processo_faturado','faturamento_iniciado']
LABELS = {'cliente':'Cliente','tipo_documento':'Tipo Documento','operacao_transporte':'Operação de Transporte','servico_terminal':'Serviço de Terminal?','remetente':'Remetente','local_coleta':'Local de Coleta','agencia_maritima':'Agência Marítima','despachante':'Despachante','ref_despachante':'Ref. Despachante','numero_bl_awb':'Nº BL / AWB','observacao':'Observação','mostrar_vias':'Mostrar Vias?','rota':'Rota','local_armazenagem':'Local de Armazenagem','data_faturamento':'Data para Faturamento','data_encerramento':'Data de Encerramento','ref_cliente':'Ref. do Cliente','numero_documento':'Nº Documento','produto':'Produto','produto_quimico':'Produto químico?','destinatario':'Destinatário','local_entrega':'Local de Entrega','navio':'Navio','numero_viagem_navio':'Nº Viagem Navio','porto_origem':'Porto de Origem','operacao_maritima':'Operação Marítima','processo_faturado':'Processo Faturado','faturamento_iniciado':'Faturamento Iniciado'}

PROMPT = '''Você é um extrator documental de logística. Analise TODAS as páginas e retorne JSON válido. Identifique IMPORTAÇÃO, EXPORTAÇÃO ou NÃO IDENTIFICADO somente por evidências. Mapeie somente os campos fornecidos. Nunca invente. Ausência = null. Checkbox: true/false somente com evidência clara; caso contrário null. Para cada campo retorne value, confidence (high/medium/low), page e source. Se houver valores conflitantes, preserve o primeiro valor? NÃO: coloque o campo como null e descreva o conflito em conflicts com as páginas. Variações como BL/Bill of Lading/B/L/Conhecimento de Embarque e DUIMP/Número DUIMP/Declaração Única de Importação devem ser reconhecidas.''' + '\nCampos: ' + ', '.join(FIELDS)


def extract_pages(raw: bytes):
    doc = fitz.open(stream=raw, filetype='pdf')
    pages = []
    for i, page in enumerate(doc, 1):
        text = page.get_text('text').strip()
        pages.append({'page': i, 'text': text})
    return pages


def classify(text: str) -> str:
    t = text.lower()
    imp = sum(x in t for x in ['duimp','declaração única de importação','importação','importador','porto de origem'])
    exp = sum(x in t for x in ['exportação','exportador','booking','porto de destino'])
    if imp > exp and imp > 0: return 'IMPORTAÇÃO'
    if exp > imp and exp > 0: return 'EXPORTAÇÃO'
    return 'NÃO IDENTIFICADO'


def mock_result(pages):
    joined='\n'.join(p['text'] for p in pages)
    operation=classify(joined)
    patterns={
      'numero_documento': r'(?:DUIMP|N[úu]mero DUIMP|Declara[çc][ãa]o [ÚU]nica[^:\n]*)\s*[:\-]?\s*([0-9]{8,}[\w\-]*)',
      'numero_bl_awb': r'(?:BL|B/L|Bill of Lading|Conhecimento de Embarque)\s*[:\-]?\s*([A-Z0-9\-]{6,})',
      'navio': r'(?:Navio|Vessel)\s*[:\-]?\s*([^\n]+)',
      'numero_viagem_navio': r'(?:N[ºo]?[\s\.]*(?:viagem|voyage))\s*[:\-]?\s*([^\n]+)',
      'porto_origem': r'(?:Porto de Origem|Port of Origin)\s*[:\-]?\s*([^\n]+)',
      'agencia_maritima': r'(?:Ag[êe]ncia Mar[íi]tima|Shipping Agent)\s*[:\-]?\s*([^\n]+)',
      'cliente': r'(?:Cliente|Customer)\s*[:\-]?\s*([^\n]+)',
      'remetente': r'(?:Remetente|Shipper|Exporter)\s*[:\-]?\s*([^\n]+)',
      'destinatario': r'(?:Destinat[áa]rio|Consignee|Importer)\s*[:\-]?\s*([^\n]+)',
      'ref_cliente': r'(?:Ref\.?\s*(?:do\s*)?Cliente|Importer Reference)\s*[:\-]?\s*([^\n]+)',
      'produto': r'(?:Produto|Description of Goods|Descrição da Mercadoria)\s*[:\-]?\s*([^\n]+)'
    }
    fields=[]
    for key in FIELDS:
        value=None; page=None
        for p in pages:
            m=re.search(patterns.get(key,r'(?!x)x'),p['text'],re.I)
            if m:
                value=m.group(1).strip(); page=p['page']; break
        fields.append({'key':key,'label':LABELS[key],'value':value,'confidence':'medium' if value else 'low','page':page,'source':f'Página {page}' if page else 'Não informado no PDF'})
    if operation != 'NÃO IDENTIFICADO':
        for f in fields:
            if f['key']=='operacao_maritima': f.update(value='Importação' if operation=='IMPORTAÇÃO' else 'Exportação', confidence='high', page=1, source='Classificação documental')
    return {'process_type':operation,'fields':fields,'conflicts':[],'pages':len(pages)}

async def ai_result(pages):
    api_key=os.getenv('AI_API_KEY'); url=os.getenv('AI_API_URL'); model=os.getenv('AI_MODEL','gpt-4o-mini')
    if not api_key or not url: return None
    content='\n\n'.join(f'--- PÁGINA {p["page"]} ---\n{p["text"]}' for p in pages)
    body={'model':model,'temperature':0,'messages':[{'role':'system','content':PROMPT},{'role':'user','content':content}],'response_format':{'type':'json_object'}}
    async with httpx.AsyncClient(timeout=90) as client:
        r=await client.post(url,headers={'Authorization':f'Bearer {api_key}'},json=body); r.raise_for_status()
        data=r.json(); raw=data['choices'][0]['message']['content']; return json.loads(raw)

@app.get('/api/health')
async def health(): return {'status':'ok'}

@app.post('/api/analyze')
async def analyze(file: UploadFile=File(...)):
    if file.content_type != 'application/pdf' and not (file.filename or '').lower().endswith('.pdf'):
        raise HTTPException(400,'Somente PDF é aceito.')
    raw=await file.read()
    if len(raw)>MAX_MB*1024*1024: raise HTTPException(413,f'Arquivo excede {MAX_MB} MB.')
    try: pages=extract_pages(raw)
    except Exception as exc: raise HTTPException(422,f'Não foi possível ler o PDF: {exc}')
    if not pages: raise HTTPException(422,'PDF sem páginas legíveis.')
    try: data=await ai_result(pages) or mock_result(pages)
    except Exception: data=mock_result(pages)
    data['filename']=file.filename or 'documento.pdf'; data['pages']=len(pages)
    return data
