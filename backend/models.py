import datetime

from sqlalchemy import Column, Integer, Text, String, ForeignKey, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import declarative_base
from pgvector.sqlalchemy import Vector


Base = declarative_base()


class DocumentChunk(Base):
    __tablename__ = 'document_chunks'

    id = Column(Integer, primary_key=True)
    content = Column(Text, nullable=False)
    metadata_json = Column(JSONB)

    # 768 is the dimension size for Gemini's text-embedding-004 model
    embedding = Column(Vector(768))


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True)
    session_id = Column(String, index=True)
    role = Column(String)
    content = Column(Text)


class DocumentAnalysisRecord(Base):
    __tablename__ = "analysis_results"

    id = Column(Integer, primary_key=True)
    content = Column(Text)
    entities = Column(Text)
    created_at = Column(DateTime, default=datetime.datetime.now)
    status = Column(String)


class IngestionTask(Base):
    __tablename__ = "ingestion_tasks"
    id = Column(String, primary_key=True)
    status = Column(String)
    filename = Column(String)
