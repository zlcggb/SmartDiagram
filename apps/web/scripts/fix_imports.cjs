const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const files = execSync('find src -type f -name "*.ts" -o -name "*.tsx"').toString().split('\n').filter(Boolean);

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let original = content;
    
    // Fix broken PPT workspace store/hooks that were originally in PPT root but are now shared
    content = content.replace(/from ['"]@\/shared\/store\/workbenchStore['"]/g, "from '@/features/ppt/store/workbenchStore'");
    content = content.replace(/from ['"]@\/shared\/hooks\/useStudioWizard['"]/g, "from '@/features/ppt/hooks/useStudioWizard'");
    
    // Fix Diagram dependencies incorrectly mapped to @/shared
    content = content.replace(/from ['"]@\/shared\/store\/chatStore['"]/g, "from '@/features/diagram/model/chatStore'");
    content = content.replace(/from ['"]@\/shared\/lib\/diagramHistory['"]/g, "from '@/features/diagram/model/diagramHistory'");
    
    // Auth & config
    content = content.replace(/from ['"]@\/shared\/lib\/config\/auth['"]/g, "from '@/shared/store/auth'");
    content = content.replace(/from ['"]\.\.\/config\/auth['"]/g, "from '@/shared/store/auth'");
    content = content.replace(/from ['"]\.\.\/\.\.\/config\/auth['"]/g, "from '@/shared/store/auth'");
    content = content.replace(/from ['"]\.\.\/config\/auth['"]/g, "from '@/shared/store/auth'");
    
    // Broken shared references from PPT
    content = content.replace(/from ['"]\.@ppt-agent\/shared['"]/g, "from '@ppt-agent/shared'");

    // Missing main layout shells
    content = content.replace(/from ['"](\.\/)?components\/shell\/AppShell['"]/g, "from '@/shared/ui/shell/AppShell'");
    content = content.replace(/from ['"](\.\/)?pages\/HomePage['"]/g, "from '@/pages/home/HomePage'");
    content = content.replace(/from ['"](\.\/)?ppt\/PptModule['"]/g, "from '@/features/ppt/PptModule'");
    content = content.replace(/from ['"](\.\.\/)+shell\/shellEvents['"]/g, "from '@/shared/ui/shell/shellEvents'");
    
    // Misc
    content = content.replace(/from ['"](\.\.\/)+macos\/MacOSIcons['"]/g, "from '@/shared/ui/macos/MacOSIcons'");
    content = content.replace(/from ['"](\.\.\/)+brand\/AppIconMarks['"]/g, "from '@/shared/ui/components/AppIconMarks'");
    content = content.replace(/from ['"](\.\.\/)+auth\/LoginScreen['"]/g, "from '@/components/auth/LoginScreen'");
    
    // Diagrams configs
    content = content.replace(/from ['"](\.\.\/)+config\/diagramAgents['"]/g, "from '@/shared/lib/config/diagramAgents'");
    content = content.replace(/from ['"](\.\.\/)+types\/diagram['"]/g, "from '@/types/diagram'");
    content = content.replace(/from ['"](\.\.\/)+config\/enterpriseContext['"]/g, "from '@/shared/lib/config/enterpriseContext'");
    
    if (content !== original) {
        fs.writeFileSync(file, content);
    }
});
