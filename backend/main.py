from fastapi import FastAPI


app = FastAPI(title="CallFlow API")

@app.get("/health")
def health():
    return {"status": "ok", "service": "callflow-api"}