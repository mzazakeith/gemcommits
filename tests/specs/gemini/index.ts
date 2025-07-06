import { testSuite } from 'manten';

export default testSuite(({ describe }) => {
	describe('Gemini', ({ runTestSuite }) => {
		runTestSuite(import('./conventional-commits.js'));
	});
});
