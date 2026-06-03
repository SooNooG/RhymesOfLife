import io
from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction
from django.test import SimpleTestCase, TestCase, override_settings

from PIL import Image

from .forms import RegisterForm
from .models import (
    AdditionalUserInfo,
    HelpRequest,
    MedicalDocument,
    MedicalExam,
    MedicationEntry,
    Notification,
    PatientAccessRequest,
    Post,
    PostComment,
    PostLike,
    WellnessEntry,
)
from .utils.access import has_patient_access
from .utils.files import validate_image_upload, validate_mixed_upload
from .utils.notify import send_notification_multichannel


User = get_user_model()


class RegisterFormTests(TestCase):
    def test_register_form_accepts_valid_data(self):
        form = RegisterForm(
            data={
                "username": "newuser",
                "email": "newuser@example.com",
                "password1": "StrongPass123!",
                "password2": "StrongPass123!",
            }
        )

        self.assertTrue(form.is_valid(), form.errors)

        user = form.save()

        self.assertEqual(user.email, "newuser@example.com")
        self.assertTrue(AdditionalUserInfo.objects.filter(user=user, email=user.email).exists())

    def test_register_form_rejects_invalid_email(self):
        form = RegisterForm(
            data={
                "username": "newuser",
                "email": "not-an-email",
                "password1": "StrongPass123!",
                "password2": "StrongPass123!",
            }
        )

        self.assertFalse(form.is_valid())
        self.assertIn("email", form.errors)

    def test_register_form_rejects_empty_required_fields(self):
        form = RegisterForm(data={"username": "", "email": "", "password1": "", "password2": ""})

        self.assertFalse(form.is_valid())
        self.assertIn("username", form.errors)
        self.assertIn("email", form.errors)
        self.assertIn("password1", form.errors)
        self.assertIn("password2", form.errors)

    def test_register_form_rejects_weak_password(self):
        form = RegisterForm(
            data={
                "username": "newuser",
                "email": "newuser@example.com",
                "password1": "12345678",
                "password2": "12345678",
            }
        )

        self.assertFalse(form.is_valid())
        self.assertTrue(any(field in form.errors for field in ("password1", "password2", "__all__")))


class BaseModelTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.patient_user = User.objects.create_user(
            username="patient",
            email="patient@example.com",
            password="StrongPass123!",
        )
        cls.doctor_user = User.objects.create_user(
            username="doctor",
            email="doctor@example.com",
            password="StrongPass123!",
        )
        cls.patient_info = AdditionalUserInfo.objects.create(user=cls.patient_user, email=cls.patient_user.email)
        cls.doctor_info = AdditionalUserInfo.objects.create(user=cls.doctor_user, email=cls.doctor_user.email)

    def test_additional_user_info_is_linked_to_user(self):
        self.assertEqual(self.patient_info.user, self.patient_user)
        self.assertFalse(self.patient_info.is_verified)
        self.assertFalse(self.patient_info.ready_for_verification)
        self.assertFalse(self.patient_info.email_verified)

    def test_medical_exam_can_be_created_with_default_soft_delete_state(self):
        exam = MedicalExam.objects.create(
            user_info=self.patient_info,
            exam_date=date(2026, 1, 15),
            description="Routine annual checkup",
        )

        self.assertEqual(exam.user_info, self.patient_info)
        self.assertEqual(exam.description, "Routine annual checkup")
        self.assertFalse(exam.is_deleted)

    def test_medical_exam_soft_delete_marks_record_as_deleted(self):
        exam = MedicalExam.objects.create(
            user_info=self.patient_info,
            exam_date=date(2026, 1, 15),
            description="Routine annual checkup",
        )

        exam.delete()
        exam.refresh_from_db()

        self.assertTrue(exam.is_deleted)
        self.assertIsNotNone(exam.deleted_at)
        self.assertEqual(MedicalExam.objects.filter(pk=exam.pk).count(), 0)
        self.assertEqual(MedicalExam.all_objects.filter(pk=exam.pk).count(), 1)

    def test_medical_document_can_be_linked_to_exam_with_external_url(self):
        exam = MedicalExam.objects.create(
            user_info=self.patient_info,
            exam_date=date(2026, 1, 15),
        )
        document = MedicalDocument.objects.create(
            exam=exam,
            external_url="https://example.com/report.pdf",
        )

        self.assertEqual(document.exam, exam)
        self.assertEqual(document.external_url, "https://example.com/report.pdf")
        self.assertFalse(document.is_deleted)

    def test_wellness_entry_accepts_score_in_allowed_range(self):
        entry = WellnessEntry(
            user_info=self.patient_info,
            date=date(2026, 2, 2),
            score=7,
            note="Stable condition",
        )

        entry.full_clean()
        entry.save()

        self.assertEqual(entry.user_info, self.patient_info)
        self.assertEqual(entry.score, 7)

    def test_wellness_entry_rejects_score_outside_allowed_range(self):
        entry = WellnessEntry(
            user_info=self.patient_info,
            date=date(2026, 2, 2),
            score=11,
            note="Invalid score",
        )

        with self.assertRaises(ValidationError):
            entry.full_clean()

    def test_medication_entry_can_be_created(self):
        medication = MedicationEntry.objects.create(
            user_info=self.patient_info,
            description="Pregabalin 75 mg daily",
        )

        self.assertEqual(medication.user_info, self.patient_info)
        self.assertEqual(medication.description, "Pregabalin 75 mg daily")
        self.assertFalse(medication.is_deleted)

    def test_access_check_is_false_before_approval_and_true_after_approval(self):
        access_request = PatientAccessRequest.objects.create(
            patient=self.patient_info,
            doctor=self.doctor_info,
        )

        self.assertEqual(access_request.status, PatientAccessRequest.Status.PENDING)
        self.assertFalse(has_patient_access(self.doctor_user, self.patient_info))

        access_request.status = PatientAccessRequest.Status.APPROVED
        access_request.save(update_fields=["status"])

        self.assertTrue(has_patient_access(self.doctor_user, self.patient_info))

    def test_access_request_can_be_rejected(self):
        access_request = PatientAccessRequest.objects.create(
            patient=self.patient_info,
            doctor=self.doctor_info,
        )

        access_request.status = PatientAccessRequest.Status.DENIED
        access_request.save(update_fields=["status"])
        access_request.refresh_from_db()

        self.assertEqual(access_request.status, PatientAccessRequest.Status.DENIED)
        self.assertFalse(has_patient_access(self.doctor_user, self.patient_info))

    @override_settings(TELEGRAM_BOT_TOKEN_USERS="token")
    @patch("base.utils.notify.send_email", return_value=True)
    @patch("base.utils.notify.send_bot_message", return_value=True)
    def test_notification_service_creates_site_notification(self, mock_send_bot_message, mock_send_email):
        result = send_notification_multichannel(
            recipient=self.patient_info,
            sender=self.doctor_info,
            notification_type="ACCESS_GRANTED",
            title="Access granted",
            message="The request was approved.",
            via_site=True,
            via_email=True,
            via_telegram=False,
        )

        notification = Notification.objects.get(pk=result["notification_id"])

        self.assertEqual(notification.recipient, self.patient_info)
        self.assertEqual(notification.sender, self.doctor_info)
        self.assertEqual(notification.title, "Access granted")
        self.assertEqual(notification.message, "The request was approved.")
        self.assertEqual(notification.scope, Notification.Scope.PERSONAL)
        self.assertEqual(notification.source, Notification.Source.SYSTEM)
        self.assertFalse(notification.is_read)
        self.assertTrue(result["email_sent"])
        self.assertFalse(result["telegram_sent"])
        mock_send_email.assert_called_once()
        mock_send_bot_message.assert_not_called()

    def test_post_can_be_created_with_expected_default_flags(self):
        post = Post.objects.create(author=self.patient_info, text="Daily update")

        self.assertEqual(post.author, self.patient_info)
        self.assertEqual(post.text, "Daily update")
        self.assertFalse(post.is_hidden)
        self.assertFalse(post.is_deleted)
        self.assertFalse(post.is_approved)

    def test_post_comment_is_linked_to_post_and_author(self):
        post = Post.objects.create(author=self.patient_info, text="Daily update")
        comment = PostComment.objects.create(post=post, author=self.doctor_info, text="Take care")

        self.assertEqual(comment.post, post)
        self.assertEqual(comment.author, self.doctor_info)

    def test_post_like_duplicate_is_rejected(self):
        post = Post.objects.create(author=self.patient_info, text="Daily update")
        PostLike.objects.create(post=post, author=self.doctor_info)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                PostLike.objects.create(post=post, author=self.doctor_info)

    def test_help_request_can_be_marked_processed(self):
        help_request = HelpRequest.objects.create(
            user=self.patient_user,
            name="Patient Name",
            email="patient@example.com",
            message="Need assistance with medications.",
        )

        self.assertEqual(help_request.user, self.patient_user)
        self.assertEqual(help_request.message, "Need assistance with medications.")
        self.assertEqual(help_request.status, HelpRequest.Status.OPEN)
        self.assertFalse(help_request.is_processed)

        help_request.mark_processed(self.doctor_user)
        help_request.refresh_from_db()

        self.assertEqual(help_request.status, HelpRequest.Status.DONE)
        self.assertTrue(help_request.is_processed)
        self.assertEqual(help_request.processed_by, self.doctor_user)


class BaseFileValidationTests(SimpleTestCase):
    def create_png_upload(self, name="image.png", size=(10, 10), content_type="image/png"):
        stream = io.BytesIO()
        image = Image.new("RGB", size, color="blue")
        image.save(stream, format="PNG")
        return SimpleUploadedFile(name, stream.getvalue(), content_type=content_type)

    @patch("base.utils.files._safe_mime_from_buffer", return_value="image/png")
    def test_allowed_image_type_passes_validation(self, _mock_mime):
        uploaded = self.create_png_upload()

        ok, error = validate_image_upload(
            uploaded,
            max_size_bytes=1024 * 1024,
            allowed_mimes={"image/png"},
            allowed_formats={"PNG"},
        )

        self.assertTrue(ok)
        self.assertIsNone(error)

    @patch("base.utils.files._safe_mime_from_buffer", return_value="application/octet-stream")
    def test_disallowed_extension_is_rejected(self, _mock_mime):
        uploaded = SimpleUploadedFile("script.exe", b"binary", content_type="application/octet-stream")

        ok, error = validate_mixed_upload(
            uploaded,
            allowed_exts={".png", ".pdf"},
            allowed_mimes={"image/png", "application/pdf"},
            max_size_bytes=1024 * 1024,
            max_image_side_px=2000,
        )

        self.assertFalse(ok)
        self.assertIn("Invalid extension", error)
