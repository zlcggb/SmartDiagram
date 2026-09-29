import asyncio

from app.services import resume_extraction_service
from app.services.resume_extraction_service import _collapse_letter_spacing, _text_layer_garbled
from app.services.talent_screening_service import extract_resume_profile

GARBLED = """个 人 简 历
教 育 背 景
个 人 信 息
姓 名 ： 籍 贯 ：
年 龄 ： 邮 箱 ：
电 话 ： 微 信 ：
肖 雨 航 江 苏 扬 州
东 南 大 学 2 0 2 4 . 0 9  -  2 0 2 7 . 0 6工 学 硕 士 交 通 运 输"""


def test_garbled_label_grid_is_detected_and_spacing_collapsed():
    assert _text_layer_garbled(GARBLED)
    collapsed = _collapse_letter_spacing(GARBLED)
    assert "教育背景" in collapsed
    assert "2024.09 - 2027.06" in collapsed
    assert not _text_layer_garbled("姓名：张三\n邮箱：a@b.com\n教育背景\n2020.09-2024.06 东南大学 本科")


def test_unassigned_unicode_glyphs_are_detected_as_garbled():
    assert _text_layer_garbled("Name 2024 \u0378\u0378\u0378\u0378")


def test_pdfium_text_layer_is_used_before_pypdf(monkeypatch, tmp_path):
    import pypdfium2 as pdfium

    class FakeTextPage:
        def get_text_range(self):
            return "周刘成\n电话：150-8930-1701\n邮箱：kundricklesley@gmail.com\nPython 后端工程师\n" + "负责 AI Agent 与业务系统开发，具备后端 API、数据建模和工程交付经验。" * 3

        def close(self):
            pass

    class FakePage:
        def get_textpage(self):
            return FakeTextPage()

        def close(self):
            pass

    class FakeDocument:
        def __init__(self, _path):
            self.pages = [FakePage()]

        def __len__(self):
            return len(self.pages)

        def __getitem__(self, index):
            return self.pages[index]

        def close(self):
            pass

    path = tmp_path / "resume.pdf"
    path.write_bytes(b"%PDF-1.7")
    monkeypatch.setattr(pdfium, "PdfDocument", FakeDocument)

    def unexpected_pypdf(*_args, **_kwargs):
        raise AssertionError("resume extraction should prefer PDFium")

    monkeypatch.setattr(resume_extraction_service, "parse_file", unexpected_pypdf)
    parsed = asyncio.run(resume_extraction_service.extract_resume_document(
        path,
        mime_type="application/pdf",
        filename="resume.pdf",
    ))

    assert "周刘成" in parsed["blocks"][0]["text"]
    assert parsed["metadata"]["parser"] == "pdfium"


def test_failed_ocr_discards_garbled_page_and_requires_review(monkeypatch, tmp_path):
    path = tmp_path / "resume.pdf"
    path.write_bytes(b"%PDF-1.7")
    garbled_text = "姓名：周刘成\n" + "Python 后端经历 2024 \u0378\u0378\n" * 8
    monkeypatch.setattr(resume_extraction_service, "_parse_pdfium_document", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(resume_extraction_service, "parse_file", lambda *_args, **_kwargs: {
        "filename": "resume.pdf",
        "mime_type": "application/pdf",
        "blocks": [{"type": "text", "text": garbled_text, "page": 1, "metadata": {"page": 1}}],
        "metadata": {"suffix": ".pdf", "page_count": 1, "route_mode": "full-context"},
    })
    monkeypatch.setattr(resume_extraction_service, "_pdf_page_images", lambda *_args: {})
    monkeypatch.setattr(resume_extraction_service, "_render_pdf_pages", lambda *_args: {1: b"page"})

    async def failed_ocr(_images, **_kwargs):
        return ["姓名：周刘成\n" + "识别错误 2024 \u0378\u0378\u0378\u0378\n" * 12]

    monkeypatch.setattr(resume_extraction_service, "_ocr_many", failed_ocr)
    parsed = asyncio.run(resume_extraction_service.extract_resume_document(
        path,
        mime_type="application/pdf",
        filename="resume.pdf",
    ))

    assert parsed["blocks"] == []
    assert parsed["metadata"]["processing_status"] == "review_required"
    assert parsed["metadata"]["extraction"]["verified"] is False
    assert parsed["metadata"]["extraction"]["unresolved_pages"] == [1]


def test_unverified_document_requires_usable_manual_text():
    document = {
        "blocks": [{"type": "text", "text": "untrusted"}],
        "metadata": {
            "processing_status": "review_required",
            "extraction": {"quality": "poor", "verified": False, "page_count": 1},
        },
    }

    assert resume_extraction_service.resolve_resume_document(document, "短文本") is None
    resolved = resume_extraction_service.resolve_resume_document(
        document,
        "姓名：周刘成\n电话：150-8930-1701\n邮箱：kundricklesley@gmail.com\nPython 后端工程师，负责 AI Agent 项目开发。",
    )

    assert resolved["metadata"]["processing_status"] == "parsed"
    assert resolved["metadata"]["route_mode"] == "manual"
    assert resolved["metadata"]["extraction"]["method"] == "manual"
    assert "untrusted" not in resolved["blocks"][0]["text"]


def test_label_is_never_taken_as_name_or_location():
    profile = extract_resume_profile(_collapse_letter_spacing(GARBLED))
    assert profile["full_name"] not in {"籍贯：", "籍贯", "实习经历", "个人信息"}
    assert "：" not in profile["full_name"]
    assert "：" not in profile["location"]


def test_ai_reviewed_fields_parse_cleanly():
    profile = extract_resume_profile("个人信息\n姓名：肖雨航\n籍贯：江苏扬州\n电话：184-5165-9285\n邮箱：yuhang.xiao@qq.com")
    assert profile["full_name"] == "肖雨航"
    assert profile["location"] == "江苏扬州"
    assert profile["phone"] == "18451659285"
    assert extract_resume_profile("姓名：张三 籍贯：北京")["full_name"] == "张三"
