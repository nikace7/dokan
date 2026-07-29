"""Pagination — page/limit for catalog lists, envelope-wrapped.

Design §8.4: cursor pagination on transaction lists, page/limit on catalog.
The envelope carries page metadata in ``meta`` so list responses keep the
same shape as every other endpoint.
"""

from typing import Any

from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class EnvelopePageNumberPagination(PageNumberPagination):
    """Page/limit pagination rendered inside the API envelope."""

    page_size = 50
    page_size_query_param = "limit"
    max_page_size = 200

    def get_paginated_response(self, data: list[Any]) -> Response:
        """Return {"data": [...], "meta": {...}, "error": null}."""
        assert self.page is not None
        request = self.request
        assert request is not None  # set by paginate_queryset before this is called
        return Response(
            {
                "data": data,
                "meta": {
                    "count": self.page.paginator.count,
                    "page": self.page.number,
                    "total_pages": self.page.paginator.num_pages,
                    "page_size": self.get_page_size(request),
                },
                "error": None,
            }
        )
