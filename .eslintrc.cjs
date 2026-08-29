module.exports = {
  root: true,
  env: { 
    browser: true, 
    es2020: true 
  },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'public/electron.cjs', 'public/preload.cjs'],
  // Test files run under Node, so process/Buffer are legitimately defined
  // there. Scoped to *.test.js so app code keeps its browser-only globals.
  overrides: [
    {
      files: ['**/*.test.js'],
      env: { node: true },
    },
  ],
  parserOptions: { 
    ecmaVersion: 'latest', 
    sourceType: 'module' 
  },
  settings: { 
    react: { 
      version: '18.2' 
    } 
  },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
  }
}