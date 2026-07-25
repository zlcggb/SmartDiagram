import { describe, it, expect } from 'vitest';
import { normalizeMermaidCode, balanceBlocks } from '../mermaidSanitizer';

describe('balanceBlocks', () => {
  it('移除多余的 end（用户报告的原始 bug）', () => {
    const code = `sequenceDiagram
    actor User as 终端用户
    participant App as 前端应用
    alt 输入违反安全策略
        App-->>User: 拦截
    else 输入合规
        alt 输出违反安全策略
            App-->>User: 兜底
        else 输出合规
            App-->>User: 正常回答
        end
    end
end`;
    const result = balanceBlocks(code);
    // 应该只有 2 个 end（对应 2 个 alt），第 3 个多余的 end 被移除
    const endCount = result.split('\n').filter(l => l.trim() === 'end').length;
    expect(endCount).toBe(2);
  });

  it('补全缺失的 end（流式生成场景）', () => {
    const code = `sequenceDiagram
    alt 条件A
        A->>B: 消息
    else 条件B
        A->>B: 其他消息`;
    const result = balanceBlocks(code);
    const endCount = result.split('\n').filter(l => l.trim() === 'end').length;
    expect(endCount).toBe(1);
  });

  it('移除孤立的 else（不在 alt 内）', () => {
    const code = `sequenceDiagram
    A->>B: 消息
    else 这是孤立的
    B-->>A: 回复`;
    const result = balanceBlocks(code);
    expect(result).not.toContain('else');
  });

  it('处理嵌套的 loop + alt 混合', () => {
    const code = `sequenceDiagram
    loop 每天
        alt 条件
            A->>B: 消息
        else 其他
            A->>C: 消息
        end
    end`;
    const result = balanceBlocks(code);
    const endCount = result.split('\n').filter(l => l.trim() === 'end').length;
    expect(endCount).toBe(2);
    // 确保内容完整保留
    expect(result).toContain('loop 每天');
    expect(result).toContain('alt 条件');
  });

  it('处理 flowchart subgraph 的多余 end', () => {
    const code = `flowchart TD
    subgraph 子图A
        A --> B
    end
end`;
    const result = balanceBlocks(code);
    const endCount = result.split('\n').filter(l => l.trim() === 'end').length;
    expect(endCount).toBe(1);
  });

  it('不影响无块关键字的图表', () => {
    const code = `erDiagram
    USER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains`;
    expect(balanceBlocks(code)).toBe(code);
  });
});

describe('normalizeMermaidCode', () => {
  it('移除行尾分号', () => {
    const code = `sequenceDiagram
    A->>B: 消息;
    B-->>A: 回复;`;
    const result = normalizeMermaidCode(code);
    expect(result).not.toMatch(/;$/m);
  });

  it('保留 classDef 行中的分号', () => {
    const code = `flowchart TD
    A --> B
    classDef red fill:#f00,stroke:#333,stroke-width:2px;`;
    const result = normalizeMermaidCode(code);
    expect(result).toContain('stroke-width:2px;');
  });

  it('去重 autonumber', () => {
    const code = `sequenceDiagram
    autonumber
    autonumber
    A->>B: 消息`;
    const result = normalizeMermaidCode(code);
    const autonumberCount = result.split('\n').filter(l => l.trim() === 'autonumber').length;
    expect(autonumberCount).toBe(1);
  });

  it('去重 participant 声明', () => {
    const code = `sequenceDiagram
    participant A as 服务A
    participant A as 服务A
    participant B as 服务B
    A->>B: 消息`;
    const result = normalizeMermaidCode(code);
    const partCount = result.split('\n').filter(l => l.trim().startsWith('participant A')).length;
    expect(partCount).toBe(1);
  });

  it('处理 Windows 换行符', () => {
    const code = "sequenceDiagram\r\n    A->>B: 消息\r\n    B-->>A: 回复";
    const result = normalizeMermaidCode(code);
    expect(result).not.toContain('\r');
  });

  it('折叠多余空行', () => {
    const code = `sequenceDiagram


    A->>B: 消息



    B-->>A: 回复`;
    const result = normalizeMermaidCode(code);
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('移除代码围栏', () => {
    const code = '```mermaid\nsequenceDiagram\n    A->>B: hi\n```';
    const result = normalizeMermaidCode(code);
    expect(result).not.toContain('```');
    expect(result).toContain('sequenceDiagram');
  });

  it('综合场景：用户报告的完整序列图', () => {
    const code = `sequenceDiagram
    autonumber
    actor User as 终端用户
    participant App as 前端应用
    participant Gateway as API 网关

    User->>App: 输入 Prompt 提问
    App->>Gateway: 发送请求 (POST /v1/chat)

    alt 输入违反安全策略
        Gateway-->>App: 返回错误
        App-->>User: 提示不合规
    else 输入合规
        Gateway->>App: 允许
        alt 输出违反安全策略
            App-->>User: 兜底回答
        else 输出合规
            App-->>User: 正常回答
        end
    end
end`;
    // 不应抛异常，多余的 end 应被移除
    const result = normalizeMermaidCode(code);
    const endCount = result.split('\n').filter(l => l.trim() === 'end').length;
    expect(endCount).toBe(2);
    // 核心内容完整
    expect(result).toContain('终端用户');
    expect(result).toContain('输入违反安全策略');
    expect(result).toContain('输出合规');
  });
});
