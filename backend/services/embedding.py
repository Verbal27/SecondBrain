from sqlalchemy import select
from google import genai
from google.genai import types
from models import DocumentChunk
import os

client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY"),
)
EMBEDDING_MODEL = "gemini-embedding-001"


async def ingest_document_logic(session, text: str, metadata: dict):
    chunk_size = 500
    chunks = [text[i : i + chunk_size] for i in range(0, len(text), chunk_size)]

    response = await client.aio.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=chunks,
        config=types.EmbedContentConfig(
            task_type="RETRIEVAL_DOCUMENT", output_dimensionality=768
        ),
    )

    vectors = [e.values for e in response.embeddings]

    for chunk, vector in zip(chunks, vectors):
        db_chunk = DocumentChunk(
            content=chunk, metadata_json=metadata, embedding=vector
        )
        session.add(db_chunk)

    await session.commit()


async def find_relevant_context(
    session, user_query: str, collection_id: str = "default", limit: int = 10
):
    response = await client.aio.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=user_query,
        config=types.EmbedContentConfig(
            task_type="RETRIEVAL_QUERY", output_dimensionality=768
        ),
    )
    query_embedding = response.embeddings[0].values

    statement = (
        select(DocumentChunk)
        .where(DocumentChunk.metadata_json["collection_id"].astext == collection_id)
        .order_by(DocumentChunk.embedding.cosine_distance(query_embedding))
        .limit(limit)
    )
    result = await session.execute(statement)
    return [row[0].content for row in result.all()]
