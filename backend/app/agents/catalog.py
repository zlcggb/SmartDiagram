"""Shared task/engine catalog for SmartDiagram routing."""

from typing import Literal

TaskType = Literal[
    "sketch",
    "document",
    "flow",
    "mindmap",
    "data_chart",
    "architecture",
    "infographic",
    "general",
]

EngineType = Literal[
    "excalidraw",
    "mermaid",
    "flow",
    "mindmap",
    "charts",
    "drawio",
    "infographic",
    "general",
]

TASK_TO_ENGINE: dict[TaskType, EngineType] = {
    "sketch": "excalidraw",
    "document": "mermaid",
    "flow": "flow",
    "mindmap": "mindmap",
    "data_chart": "charts",
    "architecture": "drawio",
    "infographic": "infographic",
    "general": "general",
}

ENGINE_TO_TASK: dict[EngineType, TaskType] = {
    engine: task for task, engine in TASK_TO_ENGINE.items()
}


def get_task_for_engine(engine: str | None) -> TaskType:
    if not engine:
        return "general"
    return ENGINE_TO_TASK.get(engine, "general")


def get_default_engine_for_task(task: str | None) -> EngineType:
    if not task:
        return "general"
    return TASK_TO_ENGINE.get(task, "general")
