"""Match recomputation job.

Recomputes match scores for users based on profile changes,
new trips, or periodic refresh.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.match import Match, MatchStatus
from app.models.user import User
from app.services.match import calculate_match_score


logger = logging.getLogger("aventaro.match_jobs")


def recompute_match_for_user(db_session_factory: Any, user_id: int) -> dict[str, Any]:
    """Recompute all match scores for a specific user.
    
    Args:
        db_session_factory: Callable that returns a DB session
        user_id: User ID to recompute matches for
    
    Returns:
        Dict with results
    """
    with db_session_factory() as db:
        # Get all pending/active matches involving this user
        matches = db.scalars(
            select(Match)
            .where(
                (Match.sender_id == user_id) | (Match.receiver_id == user_id),
                Match.status == MatchStatus.pending,
            )
            .options(
                selectinload(Match.sender).selectinload(User.profile),
                selectinload(Match.receiver).selectinload(User.profile),
            )
        ).all()
        
        updated_count = 0
        for match in matches:
            other_user = match.receiver if match.sender_id == user_id else match.sender
            result = calculate_match_score(match.sender, other_user, db=db, allow_ai=False)
            match.compatibility_score = result.score
            match.compatibility_reason = result.reason
            updated_count += 1
        
        db.commit()
        
        logger.info(
            "match_recompute_completed",
            extra={
                "event_type": "match_recompute",
                "user_id": user_id,
                "matches_updated": updated_count,
            },
        )
        
        return {
            "user_id": user_id,
            "matches_updated": updated_count,
            "status": "completed",
        }


def recompute_all_matches(db_session_factory: Any, batch_size: int = 100) -> dict[str, Any]:
    """Recompute all pending match scores in batches.
    
    Args:
        db_session_factory: Callable that returns a DB session
        batch_size: Number of matches to process per batch
    
    Returns:
        Dict with results
    """
    with db_session_factory() as db:
        total_matches = int(
            db.scalar(
                select(func.count(Match.id)).where(
                    Match.status == MatchStatus.pending,
                    Match.compatibility_score.is_(None),
                )
            )
            or 0
        )
        
        processed = 0
        while True:
            matches = db.scalars(
                select(Match)
                .where(Match.status == MatchStatus.pending, Match.compatibility_score.is_(None))
                .options(
                    selectinload(Match.sender).selectinload(User.profile),
                    selectinload(Match.receiver).selectinload(User.profile),
                )
                .limit(batch_size)
            ).all()
            
            if not matches:
                break
            
            for match in matches:
                result = calculate_match_score(match.sender, match.receiver, db=db, allow_ai=False)
                match.compatibility_score = result.score
                match.compatibility_reason = result.reason
                processed += 1
            
            db.commit()
        
        logger.info(
            "match_recompute_all_completed",
            extra={
                "event_type": "match_recompute_all",
                "total_processed": processed,
                "status": "completed",
            },
        )
        
        return {
            "total_processed": processed,
            "status": "completed",
        }
