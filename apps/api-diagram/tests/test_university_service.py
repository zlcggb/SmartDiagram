from app.services.talent_evaluation_service import check_knockouts_by_rule
from app.services.talent_screening_service import extract_resume_profile
from app.services.university_service import infer_education_facts, lookup_university

RUBRIC = {
    "knockouts": [
        {"key": "ko_degree", "label": "本科及以上学历", "kind": "degree", "params": {"min_degree": "bachelor"}},
        {"key": "ko_graduation", "label": "2027 届毕业生", "kind": "graduation_year", "params": {"years": [2027]}},
    ]
}


def test_lookup_university_tiers_and_rules():
    assert lookup_university("北京邮电大学")["tags"] == ["211", "双一流"]
    assert lookup_university("清华大学")["tags"] == ["985", "211", "双一流"]
    assert lookup_university("2023年9月 重庆邮电大学 计算机学院") == {
        "name": "重庆邮电大学", "level": "本科院校", "tags": [], "source": "名称规则",
    }
    assert lookup_university("深圳职业技术学院")["level"] == "专科院校"
    assert lookup_university("麒麟软件有限公司") is None


def test_degree_and_graduation_inferred_from_school_and_enrollment():
    resume = "张三\n教育背景\n重庆邮电大学 2023 年 9 月 - 至今 计算机科学与技术\n项目经历\n某项目 2025.04 - 2026.06"
    profile = extract_resume_profile(resume)
    facts = infer_education_facts(profile, resume)
    assert facts[0]["school"] == "重庆邮电大学"
    assert facts[0]["degree"] == "本科"
    assert facts[0]["graduation_year"] == 2027

    results = {item["key"]: item for item in check_knockouts_by_rule(RUBRIC, profile, resume, facts)}
    assert results["ko_degree"]["status"] == "pass"
    assert "推断" in results["ko_degree"]["note"]
    assert results["ko_graduation"]["status"] == "pass"


def test_inferred_mismatch_stays_unknown():
    resume = "李四\n教育背景\n重庆邮电大学 2020 年 9 月 - 至今\n"
    profile = extract_resume_profile(resume)
    results = {item["key"]: item for item in check_knockouts_by_rule(RUBRIC, profile, resume)}
    assert results["ko_graduation"]["status"] == "unknown"
    assert "2024" in results["ko_graduation"]["note"]
