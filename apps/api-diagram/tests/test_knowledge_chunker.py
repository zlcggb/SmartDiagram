from app.services.knowledge_chunker import chunk_parsed_document


def _parsed(blocks):
    return {
        "filename": "deck.pptx",
        "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "blocks": blocks,
        "metadata": {"block_count": len(blocks)},
    }


def test_chunks_never_merge_different_source_locators():
    chunks = chunk_parsed_document(
        _parsed(
            [
                {"type": "text", "text": "第一页内容", "source_locator": "pptx:slide=1"},
                {"type": "text", "text": "第二页内容", "source_locator": "pptx:slide=2"},
            ]
        ),
        target_tokens=100,
        overlap_tokens=10,
    )

    assert [chunk["source_locator"] for chunk in chunks] == [
        "pptx:slide=1",
        "pptx:slide=2",
    ]
    assert chunks[0]["text"] == "第一页内容"
    assert chunks[1]["text"] == "第二页内容"


def test_long_cjk_block_is_hard_split_with_overlap_inside_locator():
    chunks = chunk_parsed_document(
        _parsed(
            [
                {
                    "type": "text",
                    "text": "一二三四五六七八九十甲乙丙丁",
                    "source_locator": "pptx:slide=3",
                }
            ]
        ),
        target_tokens=5,
        overlap_tokens=1,
    )

    assert len(chunks) >= 3
    assert all(chunk["source_locator"] == "pptx:slide=3" for chunk in chunks)
    assert all(0 < chunk["token_count"] <= 5 for chunk in chunks)
    assert chunks[0]["metadata"]["part_index"] == 1
    assert chunks[-1]["metadata"]["part_count"] == len(chunks)
