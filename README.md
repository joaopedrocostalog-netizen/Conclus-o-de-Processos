# Conclusão de Processos

Sistema web para transformar PDFs de processos logísticos de **importação e exportação** em um relatório objetivo, organizado pelos campos necessários ao sistema operacional.

## Arquitetura

`PDF → extração de texto/OCR → classificação → IA opcional → JSON estruturado → validação → interface`

- **Frontend:** React + TypeScript + Vite + Lucide
- **Backend:** FastAPI + Python
- **PDF:** PyMuPDF
- **OCR:** pytesseract/Pillow (prepare o Tesseract no servidor para PDFs digitalizados)
- **IA:** API compatível com OpenAI, opcional; sem chave o backend usa um extrator determinístico de demonstração
- **Segurança:** chaves somente no backend, validação de extensão/MIME e limite de 25 MB

## Executar

### Frontend

```bash
npm install
npm run dev
```

O Vite encaminha `/api` para `http://localhost:8000`.

### Backend

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### IA opcional

Copie `backend/.env.example` para `backend/.env` e configure `AI_API_KEY`, `AI_API_URL` e `AI_MODEL`. A chave nunca deve ser colocada no frontend.

## Fluxo

1. Arraste ou selecione um PDF.
2. O backend lê todas as páginas.
3. A operação é classificada por evidências.
4. A IA, quando configurada, retorna os campos estruturados.
5. Valores ausentes permanecem `null`.
6. A interface mostra confiança, página de origem e permite edição manual.
7. O relatório pode ser copiado ou exportado em TXT.

## Regras de integridade

- Não inventar dados.
- `null` significa que não existe evidência suficiente.
- Checkbox só deve ser `true`/`false` quando houver evidência clara.
- Conflitos devem ser apresentados para revisão, nunca escolhidos arbitrariamente.
- Os dados de exemplo usados na interface são apenas fallback de demonstração quando a API não estiver disponível.

## Build

```bash
npm run build
```

> O repositório foi inicializado do zero porque estava vazio. Antes de produção, recomenda-se adicionar persistência server-side para histórico, autenticação corporativa, OCR efetivamente ativado no servidor e testes automatizados para diferentes layouts de documentos.
