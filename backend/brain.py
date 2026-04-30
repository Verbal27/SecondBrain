import os
from dotenv import load_dotenv
from google import genai
from google.genai import types
import json
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

load_dotenv()


class AIService:
    def __init__(self):
        self.client = genai.Client(
            api_key=os.getenv("GEMINI_API_KEY"),
        )
        self.flash_model = "gemini-2.5-flash"
        self.pro_model = "gemini-3-flash-preview"

    async def stream_and_validate(
        self, prompt: str, schema_class, db: AsyncSession, max_retries: int = 2
    ):
        current_model = self.flash_model

        for attempt in range(max_retries + 1):
            full_text = ""
            print(f"Attempt {attempt + 1}: Using {current_model}")

            try:
                stream = await self.client.aio.models.generate_content_stream(
                    model=current_model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction="Analyze the context and provide a structured JSON report.",
                        response_mime_type="application/json",
                        response_schema=schema_class,
                        temperature=0.1,
                    ),
                )

                async for chunk in stream:
                    if chunk.text:
                        full_text += chunk.text
                        yield chunk.text

                clean_json = full_text.replace("```json", "").replace("```", "").strip()
                validated_data = schema_class.model_validate_json(clean_json)

                await self._save_to_db(db, validated_data)
                print(f"Validation successful! Model: {current_model}")
                return

            except (ValidationError, json.JSONDecodeError, Exception) as e:
                print(f"Validation failed: {e}.\nModel: {current_model}")
                if attempt < max_retries:
                    current_model = self.pro_model
                    yield "\n[System: Refining response for accuracy...]\n"
                else:
                    yield "\n[System: Critical failure. Could not generate valid data.]\n"

    async def _save_to_db(self, db: AsyncSession, validated_data):
        """Internal method to persist the final structured result."""
        from models import DocumentAnalysisRecord

        new_record = DocumentAnalysisRecord(
            content=validated_data.summary,
            entities=",".join(validated_data.entities),
            status="verified",
        )
        db.add(new_record)
        await db.commit()
