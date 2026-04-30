import uuid

import fitz
from fastapi import (
    FastAPI,
    UploadFile,
    File,
    Form,
    BackgroundTasks,
    Depends,
    HTTPException,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from brain import AIService
from db.db_session import get_db, AsyncSessionLocal
from models import ChatMessage, IngestionTask
from schema import DocumentAnalysis
from services.embedding import find_relevant_context, ingest_document_logic


app = FastAPI()

# Wire up backend and frontend by enabling CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def run_ingestion_task(task_id: str, text_content: str, metadata: dict):
    """A wrapper to handle session management and status tracking in the background."""
    async with AsyncSessionLocal() as session:
        try:
            # 1. Mark as processing
            task = await session.get(IngestionTask, task_id)
            if task:
                task.status = "PROCESSING"
                await session.commit()

            # 2. Run the actual vectorization
            await ingest_document_logic(session, text_content, metadata)

            # 3. Mark as completed
            # Note: We re-fetch or just update the object attached to this session
            task = await session.get(IngestionTask, task_id)
            if task:
                task.status = "COMPLETED"
                await session.commit()

        except Exception as e:
            # 4. Handle failures gracefully
            await session.rollback()
            print(f"Background task failed: {e}")
            task = await session.get(IngestionTask, task_id)
            if task:
                task.status = "FAILED"
                await session.commit()


@app.post("/chat/{session_id}")
async def chat(
    session_id: str,
    query: str,
    collection_id: str = "default",
    db: AsyncSession = Depends(get_db),
):
    # Retrieve semantic context
    context = await find_relevant_context(db, query, collection_id)

    # Refined Super-Prompt for better grounding
    final_prompt = f"""
        Using the provided context, perform a deep-dive analysis.

        Context:
        {" ".join(context)}

        User Query: {query}
    """

    ai_service = AIService()

    async def event_generator():
        # Store user message
        db.add(ChatMessage(session_id=session_id, role="user", content=query))
        await db.commit()

        full_reply = ""
        # The AIService handles the Cascade (Flash -> Pro) and validation internally
        async for token in ai_service.stream_and_validate(
            final_prompt, DocumentAnalysis, db
        ):
            full_reply += token
            yield token

        # Store model response after stream completes
        db.add(ChatMessage(session_id=session_id, role="model", content=full_reply))
        await db.commit()

    # media_type is usually text/event-stream for SSE
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/ingest")
async def ingest_route(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    collection_id: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename.endswith((".txt", ".pdf")):
        raise HTTPException(
            status_code=400, detail="Only .txt and .pdf files supported."
        )

    # 1. Generate a Task ID and save the initial state to the DB immediately
    task_id = str(uuid.uuid4())
    new_task = IngestionTask(id=task_id, status="PENDING", filename=file.filename)
    db.add(new_task)
    await db.commit()

    try:
        content_bytes = await file.read()

        # Robust PDF/TXT Extraction Logic
        if file.filename.endswith(".pdf"):
            with fitz.open(stream=content_bytes, filetype="pdf") as doc:
                text_content = ""
                for page in doc:
                    text_content += page.get_text()
        else:
            text_content = content_bytes.decode("utf-8")

        if not text_content.strip():
            # If extraction fails, mark the DB record as failed
            new_task.status = "FAILED"
            await db.commit()
            raise HTTPException(
                status_code=400, detail="File is empty or contains no extractable text."
            )

    except HTTPException:
        raise
    except Exception as e:
        new_task.status = "FAILED"
        await db.commit()
        raise HTTPException(status_code=422, detail=f"File processing error: {str(e)}")

    metadata = {"filename": file.filename, "collection_id": collection_id}

    # 2. Pass the task_id to the background task
    background_tasks.add_task(run_ingestion_task, task_id, text_content, metadata)

    # 3. Return the task_id so the frontend knows what to poll
    return {
        "task_id": task_id,
        "status": "PENDING",
        "filename": file.filename,
        "collection_id": collection_id,
    }


@app.get("/ingest/status/{task_id}")
async def get_status(task_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(IngestionTask).where(IngestionTask.id == task_id))
    task = result.scalar_one_or_none()
    return {"status": task.status if task else "not_found"}


@app.get("/collections")
async def get_collections(db: AsyncSession = Depends(get_db)):
    try:
        # Query distinct collection IDs from the document metadata
        query = text(
            "SELECT DISTINCT metadata_json->>'collection_id' FROM document_chunk WHERE metadata_json->>'collection_id' IS NOT NULL"
        )
        result = await db.execute(query)
        collections = [row[0] for row in result.fetchall()]
    except Exception as e:
        print(f"Failed to fetch collections: {e}")
        collections = []

    if "default" not in collections:
        collections.insert(0, "default")

    return {"collections": collections}
