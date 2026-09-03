# API de análise de processos

O frontend do GitHub Pages precisa de uma API pública para analisar PDFs com OCR e IA. A pasta `backend/` contém a API FastAPI completa.

## Produção

Defina no provedor de hospedagem da API:

- `AI_API_KEY`: chave da API compatível com OpenAI
- `AI_API_URL`: endpoint `/v1/chat/completions`
- `AI_MODEL`: modelo de análise
- `MAX_UPLOAD_MB`: limite de upload (opcional, padrão 25)

Depois configure no frontend a variável `VITE_API_URL` apontando para a URL HTTPS da API.
