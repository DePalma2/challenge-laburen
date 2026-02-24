import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '.env') });

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

async function main() {
  try {
    const { text, fullStream } = streamText({
      model: openrouter('openai/gpt-4o-mini'),
      prompt: 'What is the weather in San Francisco, CA in Fahrenheit?',
      tools: {
        getCurrentWeather: tool({
          description: 'Get the current weather in a given location',
          inputSchema: z.object({
            location: z.string(),
            unit: z.enum(['celsius', 'fahrenheit']).optional(),
          }),
          execute: async ({ location, unit = 'celsius' }) => {
            console.log("TOOL EXECUTED for", location);
            return `The weather is 65F.`;
          },
        }),
      },
      stopWhen: stepCountIs(5),
    });

    for await (const part of fullStream) {
      if (part.type === 'finish-step') {
        console.log("FINISH STEP:", part.finishReason);
      }
      console.log(part.type, part.type === 'text-delta' ? part.text : '');
    }

  } catch (e) {
    console.error(e);
  }
}
main();
