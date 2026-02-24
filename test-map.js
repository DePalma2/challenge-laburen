const { convertToCoreMessages, convertToModelMessages } = require('ai');
try {
  let res = convertToModelMessages([
    {
      role: 'assistant',
      content: '', // content string
      toolInvocations: [
        {
          toolCallId: '123',
          toolName: 'searchInRAG',
          args: { query: 'test' },
          result: { doc: 'abc' }
        }
      ]
    }, {
      role: 'user', content: 'test2'
    }
  ]);
  console.log("Model msgs:", JSON.stringify(res, null, 2));
} catch (e) { console.error(e) }
