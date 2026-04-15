from fastapi import APIRouter

from app.api.ai import router as ai_router
from app.api.auth import router as auth_router
from app.api.boost import router as boost_router
from app.api.chat import router as chat_router
from app.api.collections import router as collections_router
from app.api.discover import router as discover_router
from app.api.expenses import router as expenses_router
from app.api.hashtags import router as hashtags_router
from app.api.match import router as match_router
from app.api.moderation import router as moderation_router
from app.api.notifications import router as notifications_router
from app.api.payments import router as payments_router
from app.api.posts import router as posts_router
from app.api.profile import router as profile_router
from app.api.reels import router as reels_router
from app.api.stories import router as stories_router
from app.api.subscription import router as subscription_router
from app.api.support import router as support_router
from app.api.trip import router as trip_router
from app.api.users import router as users_router


api_router = APIRouter()
api_router.include_router(auth_router, tags=["auth"])
api_router.include_router(subscription_router, tags=["subscription"])
api_router.include_router(users_router, tags=["users"])
api_router.include_router(profile_router, tags=["profile"])
api_router.include_router(boost_router, tags=["boost"])
api_router.include_router(ai_router, tags=["ai"])
api_router.include_router(discover_router, tags=["discover"])
api_router.include_router(expenses_router, tags=["expenses"])
api_router.include_router(match_router, tags=["matches"])
api_router.include_router(trip_router, tags=["trip"])
api_router.include_router(chat_router, tags=["chat"])
api_router.include_router(posts_router, tags=["posts"])
api_router.include_router(reels_router, tags=["reels"])
api_router.include_router(stories_router, tags=["stories"])
api_router.include_router(hashtags_router, tags=["hashtags"])
api_router.include_router(collections_router, tags=["collections"])
api_router.include_router(moderation_router, tags=["moderation"])
api_router.include_router(notifications_router, tags=["notifications"])
api_router.include_router(payments_router, tags=["payments"])
api_router.include_router(support_router, tags=["support"])
