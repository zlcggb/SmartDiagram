"""Editable per-model pricing rates (per 1M tokens)."""

from datetime import datetime

from sqlmodel import Field, SQLModel

from app.models.common import utc_now


class ModelPricingRate(SQLModel, table=True):
    """Admin-editable price for one model, in `currency` per 1M tokens.

    These rows override both the built-in reference prices and the
    MODEL_USAGE_PRICING_JSON env fallback when resolving the effective rate.
    """

    __tablename__ = "model_pricing_rates"

    model: str = Field(primary_key=True)
    input_price: float = 0.0
    output_price: float = 0.0
    cache_price: float = 0.0
    currency: str = "CNY"
    source: str = Field(default="manual")  # manual | builtin | env
    note: str = ""
    updated_by: str = ""
    updated_at: datetime = Field(default_factory=utc_now)
