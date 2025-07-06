import { GoogleGenAI } from '@google/genai';
import { KnownError } from './error.js';
import type { CommitType } from './config.js';
import { generatePrompt } from './prompt.js';

const sanitizeMessage = (message: string) =>
	message
		.trim()
		.replace(/[\n\r]/g, '')
		.replace(/(\w)\.$/, '$1');

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

export const generateCommitMessage = async (
	apiKey: string,
	model: string,
	locale: string,
	diff: string,
	completions: number,
	maxLength: number,
	type: CommitType,
	timeout: number
) => {
	try {
		// Initialize GoogleGenAI with API key
		const genAI = new GoogleGenAI({ apiKey });
		
		// Generate system instruction from the existing prompt generator
		const systemInstruction = generatePrompt(locale, maxLength, type);

		// Configure generation parameters
		const generationConfig = {
			temperature: 0.7,
			topP: 1,
			maxOutputTokens: 200,
			candidateCount: completions,
		};

		// System instruction will be passed in the config

		// Generate content using the models.generateContent API
		const response = await genAI.models.generateContent({
			model,
			contents: [
				{
					role: 'user',
					parts: [
						{
							text: diff
						}
					]
				}
			],
			config: {
				...generationConfig,
				systemInstruction,
				...(model.includes('2.5') && model.toLowerCase().includes('flash') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
			}
		});


		
		if (!response.candidates || response.candidates.length === 0) {
			throw new KnownError('No commit messages were generated. Try again.');
		}

		// Extract text from all candidates
		interface Candidate {
			content?: {
				parts?: Array<{
					text?: string;
				}>;
			};
		}

		interface Response {
			candidates?: Candidate[];
		}

		const messages = (response as Response).candidates
			?.filter((candidate: Candidate) => candidate.content?.parts?.[0]?.text)
			.map((candidate: Candidate) => sanitizeMessage(candidate.content!.parts![0].text!)) || [];

		if (messages.length === 0) {
			throw new KnownError('No valid commit messages were generated. Try again.');
		}

		return deduplicateMessages(messages);
	} catch (error) {
		const errorAsAny = error as any;
		
		// Handle network errors
		if (errorAsAny.code === 'ENOTFOUND') {
			throw new KnownError(
				`Error connecting to ${errorAsAny.hostname} (${errorAsAny.syscall}). Are you connected to the internet?`
			);
		}

		// Handle Gemini API errors
		if (errorAsAny.status) {
			let errorMessage = `Gemini API Error: ${errorAsAny.status}`;
			
			if (errorAsAny.message) {
				errorMessage += ` - ${errorAsAny.message}`;
			}
			
			if (errorAsAny.status === 403) {
				errorMessage += '\n\nPlease check your API key and ensure you have access to the Gemini API.';
			} else if (errorAsAny.status === 429) {
				errorMessage += '\n\nRate limit exceeded. Please try again later.';
			} else if (errorAsAny.status >= 500) {
				errorMessage += '\n\nCheck the Gemini API status: https://status.cloud.google.com/';
			}
			
			throw new KnownError(errorMessage);
		}

		// Handle timeout errors
		if (errorAsAny.name === 'TimeoutError' || errorAsAny.code === 'ETIMEDOUT') {
			throw new KnownError(
				`Request timed out after ${timeout}ms. Try increasing the timeout config or check your internet connection.`
			);
		}

		// Re-throw KnownError instances
		if (error instanceof KnownError) {
			throw error;
		}

		// Handle unknown errors
		throw new KnownError(
			`Unexpected error: ${errorAsAny.message || 'Unknown error occurred'}`
		);
	}
}; 