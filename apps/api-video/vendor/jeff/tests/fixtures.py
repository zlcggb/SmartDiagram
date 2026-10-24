"""Golden requests lifted from the TypeSafe docs."""

SCORE_REQ = {
    "state": "The export button crashes the settings page in Safari. It works in Chrome, but a few of our customers only use Safari.",
    "selectedModels": ["jev-latest"],
    "questions": {
        "bug_severity": {
            "type": "score",
            "instructions": "How severe is the reported issue?",
            "criteria": [
                "Cosmetic; no impact to functionality",
                "Broken or degraded feature, but workaround exists",
                "Blocking issue; no workaround exists",
            ],
        }
    },
}

CHOICE_REQ = {
    "state": "Hi, I was charged twice for my subscription this month and need the duplicate refunded.",
    "model": "jev-latest",
    "questions": {
        "team": {
            "type": "choice",
            "instructions": "Which team should handle this?",
            "criteria": {
                "billing": "Payment or subscription issues",
                "technical": "Bugs or integration problems",
                "sales": "Pricing or account questions",
            },
        },
        "refund": {"type": "noul", "instructions": "Does the customer request a refund?"},
        "urgency": {
            "type": "noul",
            "instructions": "Does this convey urgency?",
            "criteria": {"true": "time-sensitive", "false": "no urgency"},
        },
    },
}
