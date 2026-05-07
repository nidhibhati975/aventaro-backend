"""Travel provider abstraction layer.

Base interface for travel booking providers (Amadeus, RapidAPI, etc.).
All providers must implement this interface for consistency.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any


logger = logging.getLogger("aventaro.providers")


@dataclass(frozen=True)
class SearchResult:
    """Standardized search result from any provider."""
    provider_name: str
    external_id: str
    result_type: str  # "hotel", "flight", "activity"
    title: str
    description: str | None
    location: str
    price: Decimal
    currency: str
    rating: float | None
    image_url: str | None
    metadata: dict[str, Any]
    raw_response: dict[str, Any]


@dataclass(frozen=True)
class DetailsResult:
    """Standardized details result from any provider."""
    provider_name: str
    external_id: str
    result_type: str
    title: str
    description: str | None
    location: str
    price: Decimal
    currency: str
    rating: float | None
    amenities: list[str]
    images: list[str]
    policies: dict[str, Any]
    metadata: dict[str, Any]
    raw_response: dict[str, Any]


@dataclass(frozen=True)
class ReservationResult:
    """Standardized reservation result from any provider."""
    provider_name: str
    external_id: str
    confirmation_number: str
    status: str
    total_price: Decimal
    currency: str
    check_in: datetime | None
    check_out: datetime | None
    metadata: dict[str, Any]
    raw_response: dict[str, Any]


class BaseProvider(ABC):
    """Abstract base class for travel providers.
    
    All providers must implement:
    - search: Search for available options
    - get_details: Get detailed information about a specific option
    - create_reservation: Create a booking/reservation
    """
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name identifier."""
        pass

    @property
    def booking_mode(self) -> str:
        """Booking execution mode for this provider."""
        return "live"
    
    @abstractmethod
    async def search(
        self,
        result_type: str,
        location: str | None = None,
        check_in: datetime | None = None,
        check_out: datetime | None = None,
        guests: int = 1,
        **kwargs: Any,
    ) -> list[SearchResult]:
        """Search for travel options.
        
        Args:
            result_type: Type of search ("hotel", "flight", "activity")
            location: Location to search
            check_in: Check-in date
            check_out: Check-out date
            guests: Number of guests
            **kwargs: Additional provider-specific parameters
        
        Returns:
            List of SearchResult objects
        """
        pass
    
    @abstractmethod
    async def get_details(
        self,
        result_type: str,
        external_id: str,
    ) -> DetailsResult:
        """Get detailed information about a specific option.
        
        Args:
            result_type: Type of option ("hotel", "flight", "activity")
            external_id: Provider's unique identifier for the option
        
        Returns:
            DetailsResult object
        """
        pass
    
    @abstractmethod
    async def create_reservation(
        self,
        result_type: str,
        external_id: str,
        guest_details: dict[str, Any],
        payment_details: dict[str, Any],
    ) -> ReservationResult:
        """Create a reservation.
        
        Args:
            result_type: Type of reservation ("hotel", "flight", "activity")
            external_id: Provider's unique identifier
            guest_details: Guest information
            payment_details: Payment information
        
        Returns:
            ReservationResult object
        """
        pass

    async def reserve(
        self,
        result_type: str,
        external_id: str,
        guest_details: dict[str, Any],
        payment_details: dict[str, Any],
    ) -> ReservationResult:
        """Alias for reservation creation used by provider implementations."""
        return await self.create_reservation(
            result_type=result_type,
            external_id=external_id,
            guest_details=guest_details,
            payment_details=payment_details,
        )
    
    async def cancel_reservation(
        self,
        external_id: str,
        reason: str | None = None,
    ) -> dict[str, Any]:
        """Cancel a reservation (optional implementation).
        
        Args:
            external_id: Reservation to cancel
            reason: Cancellation reason
        
        Returns:
            Dict with cancellation result
        """
        raise NotImplementedError("Cancellation not supported by this provider")

    async def refund_reservation(
        self,
        external_id: str,
        reason: str | None = None,
    ) -> dict[str, Any]:
        """Release/refund a provider reservation before refunding user payment.

        Providers with a dedicated refund API should override this method. The
        default delegates to cancellation because many travel providers expose
        refund eligibility through the cancellation workflow.
        """
        return await self.cancel_reservation(external_id, reason=reason or "refund_requested")

    async def confirm(
        self,
        reservation_id: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Confirm an existing reservation.

        Providers that do not require an extra confirmation step can leave this
        unimplemented and rely on the booking service to finalize state locally.
        """
        raise NotImplementedError("Confirmation not supported by this provider")
    
    async def health_check(self) -> bool:
        """Check if provider API is accessible.
        
        Returns:
            True if provider is healthy
        """
        return True


class ProviderRegistry:
    """Registry for managing travel providers."""
    
    def __init__(self) -> None:
        self._providers: dict[str, BaseProvider] = {}
    
    def register(self, provider: BaseProvider) -> None:
        """Register a provider."""
        self._providers[provider.name] = provider
        logger.info(
            "provider_registered",
            extra={
                "event_type": "provider_registered",
                "provider": provider.name,
            },
        )
    
    def get(self, name: str) -> BaseProvider | None:
        """Get a provider by name."""
        return self._providers.get(name)
    
    def list_providers(self) -> list[str]:
        """List all registered provider names."""
        return list(self._providers.keys())
    
    def get_default(self) -> BaseProvider | None:
        """Get the default registered live provider."""
        if self._providers:
            for provider in self._providers.values():
                if provider.booking_mode == "live":
                    return provider
            return next(iter(self._providers.values()))
        return None


# Global registry instance
_registry = ProviderRegistry()


def get_provider_registry() -> ProviderRegistry:
    """Get the global provider registry."""
    return _registry


def register_provider(provider: BaseProvider) -> None:
    """Register a provider with the global registry."""
    _registry.register(provider)


def get_provider(name: str) -> BaseProvider | None:
    """Get a provider from the global registry."""
    return _registry.get(name)
