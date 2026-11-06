from fastapi import FastAPI

app = FastAPI(title="AURORE AI", version="3.2.0")


@app.get("/")
def root():
    return {"message": "AURORE AI server"}


@app.get("/health")
def health():
    return {"status": "ok", "service": "aurore-ai"}
