"""The Stripe SDK surface the live gateway relies on, checked without a network.

`StripeGateway` is only ever built in live mode; the suite runs in stub mode
(§10.3), so a major SDK bump could remove or rename something it calls and
nothing would notice until a live boot. This pins the import, the client
construction with made-up keys, the exact service methods and error classes
in use, and local webhook-signature verification.
"""

import inspect

import pytest
import stripe
from app.payments import InvalidWebhookSignatureError, StripeGateway


@pytest.fixture
def gateway() -> StripeGateway:
    return StripeGateway(
        secret_key="sk_test_not_a_real_key",
        webhook_secret="whsec_not_a_real_secret",
        currency="eur",
        success_url="http://test/success",
        cancel_url="http://test/cancel",
    )


class TestStripeSdkSurface:
    def test_the_sdk_major_is_the_pinned_one(self):
        assert stripe.VERSION.split(".")[0] == "16"

    def test_the_client_exposes_the_checkout_calls_the_gateway_makes(self, gateway):
        sessions = gateway._client.v1.checkout.sessions
        for name in ("create_async", "retrieve_async", "expire_async"):
            method = getattr(sessions, name)
            assert inspect.iscoroutinefunction(method), name
        # `retrieve`/`expire` take the id positionally and `create` takes
        # `params=`; the SDK 16 signatures still accept exactly that.
        assert "params" in inspect.signature(sessions.create_async).parameters
        for name in ("retrieve_async", "expire_async"):
            first = next(iter(inspect.signature(getattr(sessions, name)).parameters))
            assert first == "session", (name, first)

    def test_the_error_classes_the_gateway_catches_exist(self):
        assert issubclass(stripe.InvalidRequestError, stripe.StripeError)
        assert issubclass(stripe.SignatureVerificationError, stripe.StripeError)

    def test_webhook_signatures_are_verified_locally(self, gateway):
        payload = b'{"id": "evt_test", "type": "checkout.session.completed"}'
        with pytest.raises(InvalidWebhookSignatureError):
            gateway._verify_signature(payload, "t=1,v1=not-a-signature")
        with pytest.raises(InvalidWebhookSignatureError):
            gateway._verify_signature(payload, "")
