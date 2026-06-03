from datetime import date

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase

from wagtail.models import Page

from base.models import AdditionalUserInfo
from .models import ArticleComment, ArticleLike, BlogIndexPage, BlogPage


User = get_user_model()


class ArticleInteractionModelTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.author_user = User.objects.create_user(
            username="article-author",
            email="article-author@example.com",
            password="StrongPass123!",
        )
        cls.reader_user = User.objects.create_user(
            username="article-reader",
            email="article-reader@example.com",
            password="StrongPass123!",
        )
        cls.author_info = AdditionalUserInfo.objects.create(user=cls.author_user, email=cls.author_user.email)
        cls.reader_info = AdditionalUserInfo.objects.create(user=cls.reader_user, email=cls.reader_user.email)

        root = Page.get_first_root_node()
        cls.index_page = root.add_child(
            instance=BlogIndexPage(
                title="Articles",
                slug="articles",
                intro="Portal articles",
            )
        )
        cls.article = cls.index_page.add_child(
            instance=BlogPage(
                title="Healthy Routine",
                slug="healthy-routine",
                date=date(2026, 3, 10),
                author=cls.author_info,
                intro="A short article intro",
                body="<p>Article body</p>",
            )
        )

    def test_article_like_is_linked_to_article_and_user(self):
        article_like = ArticleLike.objects.create(article=self.article, author=self.reader_info)

        self.assertEqual(article_like.article, self.article)
        self.assertEqual(article_like.author, self.reader_info)
        self.assertTrue(article_like.is_active)

    def test_article_like_duplicate_is_rejected(self):
        ArticleLike.objects.create(article=self.article, author=self.reader_info)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                ArticleLike.objects.create(article=self.article, author=self.reader_info)

    def test_article_comment_is_linked_to_article_and_user(self):
        comment = ArticleComment.objects.create(
            article=self.article,
            author=self.reader_info,
            text="Very helpful article",
        )

        self.assertEqual(comment.article, self.article)
        self.assertEqual(comment.author, self.reader_info)
        self.assertEqual(comment.text, "Very helpful article")
