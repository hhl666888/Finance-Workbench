from __future__ import annotations

import re
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from paddleocr import PaddleOCR

app = FastAPI(title="Finwise PaddleOCR Service")
ocr = PaddleOCR(lang="ch", use_doc_orientation_classify=True, use_doc_unwarping=True, use_textline_orientation=True)


def text_from_result(result) -> str:
    chunks: list[str] = []
    for page in result:
        data = getattr(page, "json", None)
        payload = data if isinstance(data, dict) else page
        texts = payload.get("res", {}).get("rec_texts", []) if isinstance(payload, dict) else []
        chunks.extend(str(item) for item in texts)
    return "\n".join(chunks)


def first(pattern: str, text: str) -> str:
    match = re.search(pattern, text, re.I)
    return match.group(1).strip() if match else ""


def parse_invoice(text: str) -> dict:
    total = first(r"(?:价税合计.*?小写|小写)[^0-9]{0,12}(\d+[.]\d{2})", text)
    tax = first(r"税额[^0-9]{0,12}(\d+[.]\d{2})", text)
    return {
        "number": first(r"发票号码[^0-9]*(\d{8,20})", text),
        "date": first(r"开票日期[^0-9]*(\d{4}[-年/]\d{1,2}[-月/]\d{1,2})", text),
        "seller": first(r"销售方信息[\s\S]{0,80}?名称[:：]?([^\n]+)", text),
        "sellerTaxId": first(r"销售方信息[\s\S]{0,160}?(\d{15,20}[A-Z0-9])", text),
        "buyer": first(r"购买方信息[\s\S]{0,80}?名称[:：]?([^\n]+)", text),
        "total": float(total or 0),
        "tax": float(tax or 0),
        "rawText": text,
    }


@app.post("/api/ocr/invoice")
async def invoice_ocr(file: UploadFile = File(...)):
    suffix = Path(file.filename or "invoice.jpg").suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".pdf"}:
        raise HTTPException(415, "仅支持 JPG、PNG、WebP 或 PDF")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "文件不能超过 10MB")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as temp:
        temp.write(content)
        temp.flush()
        result = ocr.predict(temp.name)
    return {"status": "SUCCESS", "fileName": file.filename, "fields": parse_invoice(text_from_result(result))}
