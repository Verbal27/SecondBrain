from pydantic import BaseModel, Field
from typing import List


class DocumentAnalysis(BaseModel):
    summary: str = Field(description="A 2-sentence executive summary")
    entities: List[str] = Field(description="List of key technical terms or people.")
    sentiment: str = Field(pattern="^(Positive|Neutral|Negative)$")
