"""Access control on the OpenAPI docs endpoint.

Schema generation itself is exercised by drf-spectacular; we only assert
the project's permission policy (admin-only) on `/api/docs/`.
"""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework import status


def test_api_docs_accessible_by_admin(admin_client):
    response = admin_client.get(reverse("api-docs"))
    assert response.status_code == status.HTTP_200_OK


@pytest.mark.django_db
def test_api_docs_forbidden_for_anonymous(client):
    response = client.get(reverse("api-docs"))
    assert response.status_code == status.HTTP_403_FORBIDDEN
