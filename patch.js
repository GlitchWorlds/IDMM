const fs = require('fs');
let code = fs.readFileSync('electron/ui/src/components/Settings.jsx', 'utf8');

// Replace standard handleSave to add mounted check
code = code.replace(
  'const handleSave = async () => {',
  'let isMounted = true;\n  useEffect(() => {\n    return () => {\n      isMounted = false;\n    };\n  }, []);\n\n  const handleSave = async () => {'
);

code = code.replace(
  'setTimeout(() => setSaved(false), 2000);',
  'setTimeout(() => {\n        if (isMounted) setSaved(false);\n      }, 2000);'
);

fs.writeFileSync('electron/ui/src/components/Settings.jsx', code);
console.log('Settings patched');
