from __future__ import annotations

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.growth import AnalyticsEvent
from app.models.user import User
from app.services.auth import get_current_user
from app.services.rate_limit import rate_limit


router = APIRouter(prefix="/support")


class FaqItemRead(BaseModel):
    id: str
    question: str
    answer: str


class SupportQueryRequest(BaseModel):
    question: str = Field(min_length=5, max_length=2000)


class SupportQueryResponse(BaseModel):
    answer: str
    ticket_reference: str


FAQ_ITEMS: list[FaqItemRead] = [
    FaqItemRead(
        id="auth-session",
        question="Why am I being asked to sign in again?",
        answer="Aventaro keeps your session on the device. If you still see the auth screen, check your network and sign in again so the latest profile sync can complete.",
    ),
    FaqItemRead(
        id="discover-ai",
        question="What does Aventaro AI do?",
        answer="Aventaro AI helps plan full trips. It suggests destinations based on your profile, travel style, budget, past trips, and saved interests, then builds a day-wise plan you can refine in chat.",
    ),
    FaqItemRead(
        id="payments-subscription",
        question="Where do I manage Premium and payment methods?",
        answer="Subscription & Premium is managed from the premium screen, while payment instruments such as UPI or PayPal are handled in Payment Methods inside Settings.",
    ),
    FaqItemRead(
        id="trip-join",
        question="How do trip join requests work?",
        answer="You can request to join a trip from Discover. The trip owner must approve the request before you are added as an approved member and gain access to group coordination features.",
    ),
]


def _build_support_answer(question: str) -> str:
    normalized = question.strip().lower()
    keyword_answers: list[tuple[tuple[str, ...], str]] = [
        (("signin", "sign in", "signup", "sign up", "login", "session"), FAQ_ITEMS[0].answer),
        (("ai", "itinerary", "trip plan", "destination", "budget"), FAQ_ITEMS[1].answer),
        (("premium", "subscription", "payment", "upi", "paypal"), FAQ_ITEMS[2].answer),
        (("trip", "join request", "approve", "member"), FAQ_ITEMS[3].answer),
    ]

    for keywords, answer in keyword_answers:
        if any(keyword in normalized for keyword in keywords):
            return f"{answer} If that does not solve it, your request has been logged for manual follow-up."

    return (
        "Thanks, your support request has been recorded. The Aventaro team can review it from the saved support log and follow up based on your account details."
    )


@router.get("/faq", response_model=list[FaqItemRead])
def get_faq(
    _: User = Depends(get_current_user),
) -> list[FaqItemRead]:
    return FAQ_ITEMS


@router.post("/query", response_model=SupportQueryResponse, status_code=status.HTTP_201_CREATED)
def submit_support_query(
    payload: SupportQueryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("support_query", 20, 300)),
) -> SupportQueryResponse:
    answer = _build_support_answer(payload.question)
    event = AnalyticsEvent(
        user_id=current_user.id,
        event_type="support.query",
        event_metadata={
            "question": payload.question,
            "answer": answer,
            "channel": "in_app",
        },
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    return SupportQueryResponse(
        answer=answer,
        ticket_reference=f"SUP-{event.id}",
    )
