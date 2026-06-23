import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

export default tseslint.config({
	ignores: ['dist/*'],
	extends: [eslint.configs.recommended, tseslint.configs.recommendedTypeChecked, tseslint.configs.stylisticTypeChecked, eslintConfigPrettier],
	plugins: {
		'@typescript-eslint': tseslint.plugin,
	},
	languageOptions: {
		parser: tseslint.parser,
		parserOptions: {
			ecmaVersion: 'latest',
			jsDocParsingMode: 'type-info',
			lib: ['esnext'],
			projectService: {
				allowDefaultProject: ['eslint.config.js'],
				defaultProject: 'tsconfig.json',
			},
			tsconfigRootDir: import.meta.dirname,
			ecmaFeatures: {
				jsx: true,
			},
		},
	},
	rules: {
		'@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }],
		'@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'with-single-extends' }],
		'@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true, ignoreVoidOperator: true }],
		'@typescript-eslint/no-explicit-any': ['warn', { ignoreRestArgs: true }],
		'@typescript-eslint/restrict-plus-operands': 'warn',
		'no-async-promise-executor': 'off',
		'@typescript-eslint/require-await': 'off',
		'@typescript-eslint/no-misused-promises': 'off',
	},
});
