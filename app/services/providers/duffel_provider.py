from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

import httpx

from app.services.external_retry import async_http_request_with_retries
from app.services.providers.base import BaseProvider, DetailsResult, ReservationResult, SearchResult
from app.utils.config import get_settings


class DuffelProvider(BaseProvider):
    @property
    def name(self) -> str:
        return "duffel"

    def _headers(self) -> dict[str, str]:
        settings = get_settings()
        if not settings.duffel_access_token:
            raise ValueError("Duffel access token is not configured")
        return {
            "Authorization": f"Bearer {settings.duffel_access_token}",
            "Duffel-Version": settings.duffel_version,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    async def _request(self, method: str, path: str, *, json: dict[str, Any] | None = None) -> dict[str, Any]:
        settings = get_settings()
        async with httpx.AsyncClient(base_url=settings.duffel_api_base_url, timeout=20.0, headers=self._headers()) as client:
            response = await async_http_request_with_retries(client, method, path, json=json)
        if response.status_code == 404:
            raise LookupError("Duffel resource not found")
        if response.status_code >= 400:
            detail = response.text[:500]
            raise ValueError(f"Duffel API request failed: {detail}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise ValueError("Duffel API returned an invalid JSON response") from exc
        return payload.get("data") if isinstance(payload, dict) and "data" in payload else payload

    def _parse_route(self, location: str | None, kwargs: dict[str, Any]) -> tuple[str, str]:
        origin = str(kwargs.get("origin") or "").strip().upper()
        destination = str(kwargs.get("destination") or "").strip().upper()
        if (not origin or not destination) and location and "-" in location:
            left, right = location.split("-", maxsplit=1)
            origin = origin or left.strip().upper()
            destination = destination or right.strip().upper()
        if len(origin) != 3 or len(destination) != 3:
            raise ValueError("Duffel flight search requires IATA origin and destination codes, for example DEL-BOM")
        return origin, destination

    async def search(
        self,
        result_type: str,
        location: str | None = None,
        check_in: datetime | None = None,
        check_out: datetime | None = None,
        guests: int = 1,
        **kwargs: Any,
    ) -> list[SearchResult]:
        if result_type != "flight":
            raise ValueError("Duffel provider currently supports flight booking searches only")
        if check_in is None:
            raise ValueError("Duffel flight search requires check_in as the departure date")
        origin, destination = self._parse_route(location, kwargs)
        slices = [{"origin": origin, "destination": destination, "departure_date": check_in.date().isoformat()}]
        if check_out is not None:
            slices.append({"origin": destination, "destination": origin, "departure_date": check_out.date().isoformat()})
        payload = {
            "data": {
                "slices": slices,
                "passengers": [{"type": "adult"} for _ in range(max(1, guests))],
                "cabin_class": str(kwargs.get("cabin_class") or "economy"),
                "return_offers": True,
            }
        }
        data = await self._request("POST", "/air/offer_requests", json=payload)
        offers = data.get("offers") or []
        results: list[SearchResult] = []
        for offer in offers:
            first_slice = (offer.get("slices") or [{}])[0]
            segments = first_slice.get("segments") or []
            carrier = ((segments[0].get("marketing_carrier") or {}).get("name") if segments else None) or "Flight"
            title = f"{carrier} {origin}-{destination}"
            amount = Decimal(str(offer.get("total_amount") or offer.get("base_amount") or "0")).quantize(Decimal("0.01"))
            if amount <= 0:
                continue
            results.append(
                SearchResult(
                    provider_name=self.name,
                    external_id=offer["id"],
                    result_type="flight",
                    title=title,
                    description=f"{origin} to {destination}",
                    location=destination,
                    price=amount,
                    currency=str(offer.get("total_currency") or "USD").upper(),
                    rating=None,
                    image_url=None,
                    metadata={
                        "origin": origin,
                        "destination": destination,
                        "expires_at": offer.get("expires_at"),
                        "passenger_count": guests,
                    },
                    raw_response=offer,
                )
            )
        return results

    async def get_details(self, result_type: str, external_id: str) -> DetailsResult:
        if result_type != "flight":
            raise ValueError("Duffel provider currently supports flight details only")
        offer = await self._request("GET", f"/air/offers/{external_id}")
        slices = offer.get("slices") or []
        first_slice = slices[0] if slices else {}
        destination = ((first_slice.get("destination") or {}).get("iata_code") if first_slice else None) or ""
        amount = Decimal(str(offer.get("total_amount") or offer.get("base_amount") or "0")).quantize(Decimal("0.01"))
        return DetailsResult(
            provider_name=self.name,
            external_id=offer["id"],
            result_type="flight",
            title=f"Flight offer {offer['id']}",
            description="Duffel flight offer",
            location=destination,
            price=amount,
            currency=str(offer.get("total_currency") or "USD").upper(),
            rating=None,
            amenities=[],
            images=[],
            policies={"expires_at": offer.get("expires_at")},
            metadata={"slices": slices},
            raw_response=offer,
        )

    def _passenger_payload(self, guest_details: dict[str, Any]) -> list[dict[str, Any]]:
        passengers = guest_details.get("passengers")
        if isinstance(passengers, list) and passengers:
            return passengers
        required = ["given_name", "family_name", "born_on", "gender", "email", "phone_number"]
        missing = [field for field in required if not guest_details.get(field)]
        if missing:
            raise ValueError(f"Duffel reservation requires passenger fields: {', '.join(missing)}")
        return [
            {
                "type": "adult",
                "given_name": guest_details["given_name"],
                "family_name": guest_details["family_name"],
                "born_on": guest_details["born_on"],
                "gender": guest_details["gender"],
                "email": guest_details["email"],
                "phone_number": guest_details["phone_number"],
            }
        ]

    async def create_reservation(
        self,
        result_type: str,
        external_id: str,
        guest_details: dict[str, Any],
        payment_details: dict[str, Any],
    ) -> ReservationResult:
        if result_type != "flight":
            raise ValueError("Duffel provider currently supports flight reservations only")
        details = await self.get_details(result_type=result_type, external_id=external_id)
        payload = {
            "data": {
                "selected_offers": [external_id],
                "passengers": self._passenger_payload(guest_details),
                "payments": [
                    {
                        "type": "balance",
                        "currency": details.currency,
                        "amount": str(details.price),
                    }
                ],
            }
        }
        order = await self._request("POST", "/air/orders", json=payload)
        return ReservationResult(
            provider_name=self.name,
            external_id=external_id,
            confirmation_number=str(order.get("booking_reference") or order.get("id")),
            status="confirmed",
            total_price=Decimal(str(order.get("total_amount") or details.price)).quantize(Decimal("0.01")),
            currency=str(order.get("total_currency") or details.currency).upper(),
            check_in=None,
            check_out=None,
            metadata={"reservation_id": order.get("id"), "provider_reference": order.get("id"), "booking_mode": "live"},
            raw_response=order,
        )

    async def confirm(
        self,
        reservation_id: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        provider_response = kwargs.get("provider_response") if isinstance(kwargs.get("provider_response"), dict) else {}
        guest_details = provider_response.get("guest_details") if isinstance(provider_response.get("guest_details"), dict) else {}
        details = await self.get_details(result_type="flight", external_id=reservation_id)
        payload = {
            "data": {
                "selected_offers": [reservation_id],
                "passengers": self._passenger_payload(guest_details),
                "payments": [
                    {
                        "type": "balance",
                        "currency": details.currency,
                        "amount": str(details.price),
                    }
                ],
            }
        }
        order = await self._request("POST", "/air/orders", json=payload)
        return {
            "status": "confirmed",
            "reservation_id": str(order.get("id") or reservation_id),
            "provider_reference": str(order.get("id") or reservation_id),
            "confirmation_number": str(order.get("booking_reference") or order.get("id") or ""),
            "provider_response": order,
        }

    async def cancel_reservation(
        self,
        external_id: str,
        reason: str | None = None,
    ) -> dict[str, Any]:
        payload = {"data": {"reason": reason or "customer_request"}}
        try:
            return await self._request("POST", f"/air/orders/{external_id}/actions/cancel", json=payload)
        except LookupError:
            raise
        except ValueError:
            return await self._request("DELETE", f"/air/orders/{external_id}")

    async def refund_reservation(
        self,
        external_id: str,
        reason: str | None = None,
    ) -> dict[str, Any]:
        return await self.cancel_reservation(external_id, reason=reason or "refund_requested")

    async def health_check(self) -> bool:
        await self._request("GET", "/air/airlines?limit=1")
        return True


def get_duffel_provider() -> DuffelProvider:
    return DuffelProvider()
