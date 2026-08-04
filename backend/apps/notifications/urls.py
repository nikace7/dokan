"""URL routes for notifications."""

from django.urls import path

from apps.notifications.views import ReceiptSmsView, SmsLogListView

app_name = "notifications"

urlpatterns = [
    path("notifications/sms", SmsLogListView.as_view(), name="sms-list"),
    path("notifications/sms/receipt", ReceiptSmsView.as_view(), name="sms-receipt"),
]
