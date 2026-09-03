import json
import os
import re
from typing import Any

import fitz
import httpx
import pytesseract
from PIL import Image
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Conclusão de Processos API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_MB = int(os.getenv("MAX_UPLOAD_MB", "25"))

FIELDS = [
    "cliente", "tipo_documento", "operacao_transporte", "servico_terminal",
    "remetente", "local_coleta", "agencia_maritima", "despachante",
    "ref_despachante", "numero_bl_awb", "observacao", "mostrar_vias", "rota",
    "local_armazenagem", "data_faturamento", "data_encerramento", "ref_cliente",
    "numero_documento", "produto", "produto_quimico", "destinatario",
    "local_entrega", "navio", "numero_viagem_navio", "porto_origem",
    "operacao_maritima", "processo_faturado", "faturamento_iniciado",
]

LABELS = {
    "cliente": "Cliente", "tipo_documento": "Tipo Documento",
    "operacao_transporte": "Operação de Transporte", "servico_terminal": "Serviço de Terminal?",
    "remetente": "Remetente", "local_coleta": "Local de Coleta",
    "agencia_maritima": "Agência Marítima", "despachante": "Despachante",
    "ref_despachante": "Ref. Despachante", "numero_bl_awb": "Nº BL / AWB",
    "observacao": "Observação", "mostrar_vias": "Mostrar Vias?", "rota": "Rota",
    "local_armazenagem": "Local de Armazenagem", "data_faturamento": "Data para Faturamento",
    "data_encerramento": "Data de Encerramento", "ref_cliente": "Ref. do Cliente",
    "numero_documento": "Nº Documento", "produto": "Produto",
    "produto_quimico": "Produto químico?", "destinatario": "Destinatário",
    "local_entrega": "Local de Entrega", "navio": "Navio",
    "numero_viagem_navio": "Nº Viagem Navio", "porto_origem": "Porto de Origem",
    "operacao_maritima": "Operação Marítima", "processo_faturado": "Processo Faturado",
    "faturamento_iniciado": "Faturamento Iniciado",
}

SYSTEM_PROMPT = f"""Você é um extrator documental especializado em logística brasileira.

Sua única fonte de verdade é o texto do PDF fornecido pelo usuário. Analise TODAS as páginas antes de responder.

OBJETIVO: preencher somente os campos necessários para conclusão de processos de importação/exportação.

REGRAS OBRIGATÓRIAS:
1. NUNCA invente, complete ou suponha um valor.
2. Se o valor não estiver explicitamente sustentado pelo PDF, use null.
3. Não use conhecimento externo para completar empresas, portos, navios, referências, números ou datas.
4. Não confunda remetente, destinatário, cliente, importador e exportador.
5. Não transforme descrição de produto em cliente.
6. Para cada valor encontrado, informe a página e uma evidência textual curta copiada do PDF (máximo 160 caracteres).
7. Se houver mais de um valor possível para o mesmo campo, não escolha arbitrariamente: use null e registre o conflito.
8. Booleanos só podem ser true/false quando houver evidência explícita; caso contrário null.
9. Identifique o tipo do processo somente por evidências presentes no documento. Pode ser IMPORTAÇÃO, EXPORTAÇÃO ou NÃO IDENTIFICADO.
10. Considere todas as páginas, inclusive DANFE/NF-e, BL/AWB, booking, DUIMP, DI/DUE e documentos anexos.
11. Para produto com vários itens, faça um resumo fiel das descrições/códigos encontrados; não crie itens.
12. Retorne SOMENTE JSON válido, sem markdown.

Formato obrigatório:
{{
  "process_type": "IMPORTAÇÃO|EXPORTAÇÃO|NÃO IDENTIFICADO",
  "fields": {{
    "campo": {{"value": null, "confidence": "high|medium|low", "page": null, "evidence": null}}
  }},
  "conflicts": []
}}

Campos permitidos: {', '.join(FIELDS)}
"""


def extract_pages(raw: bytes) -> list[dict[str, Any]]:
    doc = fitz.open(stream=raw, filetype="pdf")
    pages: list[dict[str, Any]] = []
    try:
        for i, page in enumerate(doc, 1):
            text = page.get_text("text").strip()
            ocr_used = False
            if len(text) < 20:
                try:
                    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                    text = pytesseract.image_to_string(img, lang="por+eng").strip()
                    ocr_used = bool(text)
                except Exception:
                    pass
            pages.append({"page": i, "text": text, "ocr": ocr_used})
    finally:
        doc.close()
    return pages


def classify(text: str) -> str:
    t = text.lower()
    imp_terms = [
        "duimp", "declaração única de importação", "declaração de importação",
        "importação", "importador", "ref. importador", "ref importador",
    ]
    exp_terms = [
        "due", "declaração única de exportação", "declaração de exportação",
        "exportação", "exportador", "porto de destino",
    ]
    imp = sum(t.count(term) for term in imp_terms)
    exp = sum(t.count(term) for term in exp_terms)
    if imp > exp and imp > 0:
        return "IMPORTAÇÃO"
    if exp > imp and exp > 0:
        return "EXPORTAÇÃO"
    return "NÃO IDENTIFICADO"


def normalize(data: dict[str, Any], pages: list[dict[str, Any]]) -> dict[str, Any]:
    process_type = data.get("process_type", "NÃO IDENTIFICADO")
    if process_type not in {"IMPORTAÇÃO", "EXPORTAÇÃO", "NÃO IDENTIFICADO"}:
        process_type = classify("\n".join(p["text"] for p in pages))

    raw_fields = data.get("fields", {})
    if not isinstance(raw_fields, dict):
        raw_fields = {}

    fields = []
    for key in FIELDS:
        item = raw_fields.get(key)
        if not isinstance(item, dict):
            item = {"value": item}
        value = item.get("value")
        if value == "":
            value = None
        confidence = item.get("confidence", "low")
        if confidence not in {"high", "medium", "low"}:
            confidence = "low"
        page = item.get("page")
        if not isinstance(page, int) or page < 1 or page > len(pages):
            page = None
        evidence = item.get("evidence")
        source = evidence if isinstance(evidence, str) and evidence.strip() else None
        fields.append({
            "key": key,
            "label": LABELS[key],
            "value": value,
            "confidence": confidence if value is not None else "low",
            "page": page,
            "source": source or (f"Página {page}" if page else "Não localizado no PDF"),
        })

    conflicts = data.get("conflicts", [])
    if not isinstance(conflicts, list):
        conflicts = [str(conflicts)]

    return {
        "process_type": process_type,
        "fields": fields,
        "conflicts": [str(x) for x in conflicts],
        "pages": len(pages),
        "analysis_mode": "ai",
        "ocr_pages": [p["page"] for p in pages if p.get("ocr")],
    }


def deterministic_result(pages: list[dict[str, Any]]) -> dict[str, Any]:
    """Fallback conservative. It intentionally has no company-specific values."""
    full = "\n".join(p["text"] for p in pages)
    op = classify(full)
    fields = []

    def first(patterns: list[str]) -> tuple[str | None, int | None]:
        for p in pages:
            for pattern in patterns:
                m = re.search(pattern, p["text"], re.I | re.M)
                if m and m.group(1):
                    return re.sub(r"\s+", " ", m.group(1)).strip(), p["page"]
        return None, None

    patterns: dict[str, list[str]] = {
        "tipo_documento": [r"\b(DUIMP|DUE|DI|NF-e|DANFE|AWB|B/L|BL)\b"],
        "numero_bl_awb": [r"\b(?:BL|B/L|AWB)\s*(?:N[ºo.]|No\.?|Número)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9./-]{5,})\b"],
        "numero_documento": [r"\b(?:DUIMP|DUE|DI)\s*(?:N[ºo.]|No\.?|Número)?\s*[:\-]?\s*([A-Z0-9./-]{6,})\b"],
        "navio": [r"(?:Navio|Vessel)\s*[:\-]\s*([^\n]+)"],
        "numero_viagem_navio": [r"(?:Viagem|Voyage)\s*[:\-]?\s*([^\n]+)"],
        "porto_origem": [r"(?:Porto de Origem|Port of Origin)\s*[:\-]\s*([^\n]+)"],
        "agencia_maritima": [r"(?:Agência Marítima|Agencia Maritima|Shipping Agent)\s*[:\-]\s*([^\n]+)"],
        "remetente": [r"(?:Remetente|Shipper|Exporter)\s*[:\-]\s*([^\n]+)"],
        "destinatario": [r"(?:Destinatário|Destinatario|Consignee|Importer)\s*[:\-]\s*([^\n]+)"],
        "despachante": [r"(?:Despachante|Customs Broker)\s*[:\-]\s*([^\n]+)"],
        "ref_despachante": [r"(?:Ref\.?\s*Despachante|Broker Reference)\s*[:\-]\s*([^\n]+)"],
        "ref_cliente": [r"(?:Ref\.?\s*(?:do\s*)?Cliente|Customer Reference|Importer Reference)\s*[:\-]\s*([^\n]+)"],
        "local_coleta": [r"(?:Local de Coleta|Pickup Location)\s*[:\-]\s*([^\n]+)"],
        "local_entrega": [r"(?:Local de Entrega|Delivery Location)\s*[:\-]\s*([^\n]+)"],
        "local_armazenagem": [r"(?:Local de Armazenagem|Storage Location)\s*[:\-]\s*([^\n]+)"],
        "rota": [r"(?:Rota|Route)\s*[:\-]\s*([^\n]+)"],
        "operacao_transporte": [r"(?:Operação de Transporte|Operacao de Transporte|Transport Operation)\s*[:\-]\s*([^\n]+)"],
        "cliente": [r"(?:Cliente|Customer)\s*[:\-]\s*([^\n]+)"],
    }

    for key in FIELDS:
        value, page = first(patterns.get(key, [])) if key in patterns else (None, None)
        if key == "operacao_maritima" and op != "NÃO IDENTIFICADO":
            value, page = ("Importação" if op == "IMPORTAÇÃO" else "Exportação"), 1
        fields.append({
            "key": key,
            "label": LABELS[key],
            "value": value,
            "confidence": "medium" if value is not None else "low",
            "page": page,
            "source": f"Página {page}" if page else "Não localizado no PDF",
        })

    return {
        "process_type": op,
        "fields": fields,
        "conflicts": [],
        "pages": len(pages),
        "analysis_mode": "deterministic-fallback",
        "ocr_pages": [p["page"] for p in pages if p.get("ocr")],
    }


async def ai_result(pages: list[dict[str, Any]]) -> dict[str, Any] | None:
    key = os.getenv("AI_API_KEY", "").strip()
    url = os.getenv("AI_API_URL", "").strip()
    model = os.getenv("AI_MODEL", "gpt-4o-mini").strip()
    if not key or not url:
        return None

    content = "\n\n".join(
        f"--- PÁGINA {p['page']} ---\n{p['text']}" for p in pages
    )
    body = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": content},
        ],
        "response_format": {"type": "json_object"},
    }

    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.post(
            url,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=body,
        )
        response.raise_for_status()
        payload = response.json()
        content = payload["choices"][0]["message"]["content"]
        return json.loads(content)


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "version": "2.0.0",
        "ai_configured": bool(os.getenv("AI_API_KEY", "").strip() and os.getenv("AI_API_URL", "").strip()),
    }


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    if file.content_type != "application/pdf" and not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Somente PDF é aceito.")

    raw = await file.read()
    if len(raw) > MAX_MB * 1024 * 1024:
        raise HTTPException(413, f"Arquivo excede {MAX_MB} MB.")

    try:
        pages = extract_pages(raw)
    except Exception as exc:
        raise HTTPException(422, f"Não foi possível ler o PDF: {exc}") from exc

    if not pages or not any(p["text"] for p in pages):
        raise HTTPException(422, "Não foi possível extrair texto do PDF, nem por OCR.")

    try:
        ai = await ai_result(pages)
        data = normalize(ai, pages) if ai is not None else deterministic_result(pages)
    except Exception as exc:
        # Do not silently return a fake-looking result when the AI provider fails.
        raise HTTPException(502, f"A análise por IA falhou: {type(exc).__name__}: {exc}") from exc

    data["filename"] = file.filename or "documento.pdf"
    return data
