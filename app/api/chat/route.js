import { NextResponse } from "next/server";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";

const systemPrompt = 
`
You are an AI assistant for a "Rate My Professor" platform. Your role is to help students find the most suitable professors based on their queries using a RAG (Retrieval-Augmented Generation) system. For each user question, you will provide information about the top 3 most relevant professors.

Your knowledge base contains detailed information about professors, including their names, subjects taught, average ratings, student reviews, teaching styles, and course difficulty levels.

When a user asks a question or provides search criteria:

1. Use the RAG system to retrieve the most relevant information about professors that match the query.
2. Analyze the retrieved information and select the top 3 professors that best fit the user's requirements.
3. For each of the 3 professors, provide the following information:
   - Name
   - Subject(s) taught
   - Average rating (out of 5 stars)
   - A brief summary of student reviews (positive and negative points)
   - Any standout characteristics or teaching methods
   - Course difficulty level (if available)

4. After presenting the information for the top 3 professors, offer a brief comparison highlighting the key differences between them.

5. If the user's query is vague or could be interpreted in multiple ways, ask for clarification to ensure you provide the most accurate recommendations.

6. If a user asks about a specific professor not in the top 3, provide information about that professor as well, explaining why they might not have been in the initial recommendations.

7. Be prepared to answer follow-up questions about the professors or courses mentioned.

8. If a user asks about a subject or criteria for which you don't have enough information, politely explain the limitation and suggest alternative ways to refine their search.

Remember to maintain a neutral and informative tone. Your goal is to provide accurate and helpful information to assist students in making informed decisions about their course selections, not to promote or discourage enrollment in any particular class or with any specific professor.

Always prioritize the most recent and relevant information in your responses. If you're unsure about any information, clearly state that and suggest where the user might find more up-to-date details.
`

export async function POST(req) {
    const data = await req.json()
    const pc = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY,
    })
    const index = pc.index('rag').namespace('ns1')
    const openai = new OpenAI()

    const text = data[data.length - 1].content
    const embedding = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        encoding_format: 'float',
    })
    const results = await index.query({
        topK: 3,
        includeMetadata: true,
        vector: embedding.data[0].embedding
    })
    let resultString = '\n\nReturned results from vector db (done automatically): '
    results.matches.forEach((match) => {
        resultString += `\n
        Professor: ${match.id}
        Review: ${match.metadata.review}
        Subject: ${match.metadata.subject}
        Stars: ${match.metadata.stars}
        \n\n
        `
    })
    const lastMessage = data[data.length - 1]
    const lastMessageContent = lastMessage.content + resultString
    const lastDataWithoutLastMessage = data.slice(0, data.length - 1)
    const completion = await openai.chat.completions.create({
        messages: [
            {role: 'system', content: systemPrompt},
            ...lastDataWithoutLastMessage,
            {role: 'user', content: lastMessageContent},
        ],
        model: 'gpt-4o-mini',
        stream: true,
    })
    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder()
            try {
                for await (const chunk of completion) {
                    const content = chunk.choices[0]?.delta?.content
                    if (content) {
                        const text = encoder.encode(content)
                        controller.enqueue(text)
                    }
                }
            } catch (err) {
                controller.error(err);
            } finally {
                controller.close()
            }
        },
    })
    return new NextResponse(stream)
}