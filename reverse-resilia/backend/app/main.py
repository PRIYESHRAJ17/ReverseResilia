"""
Main FastAPI Application Entrypoint for ReverseResilia.
"""

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from .api.routes import router as api_router

app = FastAPI(
    title="ReverseResilia — Goal-Driven Supply Chain Recovery",
    description="Provable mathematical supply-chain recovery under severe facility and transport disruptions.",
    version="1.0.0",
)

# Enable CORS for local frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

# Serve static functional interface files if available
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    @app.get("/")
    def serve_index():
        return FileResponse(os.path.join(static_dir, "index.html"))
