import { demoSourceText } from "@ppt-agent/shared";

process.env.DATABASE_URL ??= "file:./prisma/dev.db";

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  await prisma.project.upsert({
    where: { id: "demo-project" },
    update: {},
    create: {
      id: "demo-project",
      name: "智慧展厅二期升级",
      reportType: "项目周报",
      audience: "客户信息化负责人、销售总监、项目管理办公室",
      purpose: "说明本周进展、交付风险、待确认事项与下周计划",
      pageCount: 6,
      theme: "white-blue",
      sourceTexts: {
        create: {
          content: demoSourceText
        }
      }
    }
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Demo project seeded: demo-project");
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
