const color = {
  type: "string",
  pattern: "^(#[0-9A-Fa-f]{6}|\\$[A-Za-z][A-Za-z0-9_-]*)$"
} as const;

const bounds = {
  type: "array",
  minItems: 4,
  maxItems: 4,
  items: { type: "number" }
} as const;

const point = {
  type: "array",
  minItems: 2,
  maxItems: 2,
  items: { type: "number" }
} as const;

const fill = {
  type: "object",
  properties: {
    color,
    transparency: { type: "number", minimum: 0, maximum: 100 }
  },
  required: ["color"]
} as const;

const stroke = {
  type: "object",
  properties: {
    color,
    width: { type: "number", minimum: 0.1, maximum: 24 },
    transparency: { type: "number", minimum: 0, maximum: 100 },
    dash: { type: "string", enum: ["solid", "dash", "dot"] }
  },
  required: ["color", "width"]
} as const;

const base = {
  id: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}$" },
  name: { type: "string" },
  opacity: { type: "number", minimum: 0, maximum: 1 },
  rotation: { type: "number", minimum: -360, maximum: 360 },
  locked: { type: "boolean" }
} as const;

export const slideIrJsonSchema = {
  type: "object",
  properties: {
    schema: { type: "string", enum: ["smartslide/1"] },
    pageType: {
      type: "string",
      enum: ["cover", "section", "content", "ending"]
    },
    canvas: {
      type: "object",
      properties: {
        width: { type: "integer", enum: [1280] },
        height: { type: "integer", enum: [720] }
      },
      required: ["width", "height"]
    },
    theme: {
      type: "object",
      properties: {
        tokens: {
          type: "object",
          additionalProperties: {
            type: "string",
            pattern: "^#[0-9A-Fa-f]{6}$"
          }
        },
        fonts: {
          type: "object",
          properties: {
            heading: { type: "string" },
            body: { type: "string" },
            mono: { type: "string" }
          }
        }
      },
      required: ["tokens"]
    },
    background: {
      type: "object",
      properties: { color },
      required: ["color"]
    },
    elements: {
      type: "array",
      minItems: 1,
      maxItems: 120,
      items: {
        anyOf: [
          {
            type: "object",
            properties: {
              ...base,
              type: { type: "string", enum: ["text"] },
              bounds,
              paragraphs: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    runs: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          text: { type: "string" },
                          fontFamily: { type: "string" },
                          fontSize: {
                            type: "number",
                            minimum: 8,
                            maximum: 120
                          },
                          fontWeight: {
                            type: "integer",
                            minimum: 100,
                            maximum: 900
                          },
                          color,
                          italic: { type: "boolean" },
                          underline: { type: "boolean" },
                          letterSpacing: { type: "number" }
                        },
                        required: ["text", "fontSize", "color"]
                      }
                    },
                    align: {
                      type: "string",
                      enum: ["left", "center", "right"]
                    },
                    lineHeight: { type: "number" },
                    spaceAfter: { type: "number" }
                  },
                  required: ["runs"]
                }
              },
              verticalAlign: {
                type: "string",
                enum: ["top", "middle", "bottom"]
              },
              autoFit: { type: "string", enum: ["shrink", "clip"] }
            },
            required: ["id", "type", "bounds", "paragraphs"]
          },
          {
            type: "object",
            properties: {
              ...base,
              type: { type: "string", enum: ["shape"] },
              bounds,
              shape: {
                type: "string",
                enum: ["rect", "roundRect", "ellipse"]
              },
              fill,
              stroke,
              radius: { type: "number" }
            },
            required: ["id", "type", "bounds", "shape"]
          },
          {
            type: "object",
            properties: {
              ...base,
              type: { type: "string", enum: ["line"] },
              points: {
                type: "array",
                minItems: 2,
                maxItems: 16,
                items: point
              },
              stroke,
              markerStart: {
                type: "string",
                enum: ["none", "arrow", "circle"]
              },
              markerEnd: {
                type: "string",
                enum: ["none", "arrow", "circle"]
              }
            },
            required: ["id", "type", "points", "stroke"]
          },
          {
            type: "object",
            properties: {
              ...base,
              type: { type: "string", enum: ["image"] },
              bounds,
              source: {
                type: "object",
                properties: {
                  kind: {
                    type: "string",
                    enum: ["data", "https", "asset"]
                  },
                  value: { type: "string" }
                },
                required: ["kind", "value"]
              },
              fit: {
                type: "string",
                enum: ["contain", "cover", "stretch"]
              },
              alt: { type: "string" }
            },
            required: ["id", "type", "bounds", "source"]
          },
          {
            type: "object",
            properties: {
              ...base,
              type: { type: "string", enum: ["table"] },
              bounds,
              columns: {
                type: "array",
                minItems: 1,
                maxItems: 12,
                items: { type: "number", minimum: 1 }
              },
              rows: {
                type: "array",
                minItems: 1,
                maxItems: 30,
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      text: { type: "string" },
                      fill,
                      color,
                      fontSize: { type: "number" },
                      fontWeight: { type: "integer" },
                      align: {
                        type: "string",
                        enum: ["left", "center", "right"]
                      }
                    },
                    required: ["text"]
                  }
                }
              },
              border: stroke,
              rowGap: { type: "number" },
              columnGap: { type: "number" }
            },
            required: ["id", "type", "bounds", "columns", "rows"]
          },
          {
            type: "object",
            properties: {
              ...base,
              type: { type: "string", enum: ["chart"] },
              bounds,
              chartType: {
                type: "string",
                enum: ["bar", "line", "pie", "doughnut"]
              },
              categories: {
                type: "array",
                items: { type: "string" }
              },
              series: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    values: {
                      type: "array",
                      items: { type: "number" }
                    },
                    color
                  },
                  required: ["name", "values"]
                }
              },
              showLegend: { type: "boolean" },
              showValues: { type: "boolean" },
              title: { type: "string" }
            },
            required: [
              "id",
              "type",
              "bounds",
              "chartType",
              "categories",
              "series"
            ]
          }
        ]
      }
    },
    metadata: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        locale: { type: "string" }
      }
    }
  },
  required: [
    "schema",
    "pageType",
    "canvas",
    "theme",
    "background",
    "elements"
  ]
} as const;

