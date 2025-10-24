// Ensure jest global is available for ESM test files (guard against re-declare)
if (typeof global.jest === 'undefined') {
	const { jest } = require('@jest/globals');
	global.jest = jest;
}
