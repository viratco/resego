require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { parseString } = require('xml2js');
const util = require('util');
const app = express();
const port = process.env.PORT || 3000;

const api = axios.create({ timeout: 15000 });
const parseXml = util.promisify(parseString);

// Middleware
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json');
    next();
});

app.use(express.static('public'));
app.use(express.json());

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    next();
});

// API Helpers
async function searchSemanticScholar(query) {
    try {
        const response = await api.get('https://api.semanticscholar.org/graph/v1/paper/search', {
            params: {
                query: query,
                limit: 5,
                fields: 'title,authors,doi,abstract,year'
            }
        });
        return response.data.data || [];
    } catch (error) {
        console.error('Semantic Scholar Error:', error.message);
        return [];
    }
}

async function getCrossrefMetadata(doi) {
    if (!doi) return null;
    try {
        const response = await api.get(`https://api.crossref.org/works/${doi}`);
        return response.data.message;
    } catch (error) {
        console.error('Crossref Error:', error.message);
        return null;
    }
}

async function searchArXiv(query) {
    try {
        const response = await api.get('http://export.arxiv.org/api/query', {
            params: {
                search_query: query,
                start: 0,
                max_results: 5
            }
        });
        
        const parsed = await parseXml(response.data);
        return {
            parsed: parsed.feed.entry || [],
            raw: response.data
        };
    } catch (error) {
        console.error('arXiv Error:', error.message);
        return { parsed: [], raw: '' };
    }
}

async function getAISummary(content) {
    try {
        const response = await api.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'qwen-vl-plus',
            messages: [{
                role: 'user',
                content: `Summarize these research papers in simple terms:\n\n${content}`
            }]
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPEN_ROUTER_API}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('AI Summary Error:', error.message);
        return 'Summary unavailable due to API error';
    }
}

async function getAISuggestions(userPrompt) {
    try {
        const response = await api.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'mistralai/mistral-7b-instruct',
            messages: [{
                role: "system",
                content: "You're a research assistant. Suggest 3 better search queries based on the user's input. Respond only with a JSON array of suggestions, no explanations."
            }, {
                role: "user",
                content: `Original query: ${userPrompt}`
            }],
            temperature: 0.7,
            max_tokens: 100
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPEN_ROUTER_API}`,
                'Content-Type': 'application/json'
            }
        });

        const content = response.data.choices[0].message.content;
        return JSON.parse(content.replace(/```json/g, '').replace(/```/g, '').trim());
    } catch (error) {
        console.error('AI Suggestion Error:', error.message);
        return [];
    }
}

// Routes
app.options('/search', (req, res) => res.sendStatus(200));

app.post('/search', async (req, res) => {
    try {
        const prompt = req.body.prompt?.trim();
        if (!prompt || prompt.length < 3) {
            return res.status(400).json({ 
                success: false,
                error: 'Please enter at least 3 characters'
            });
        }

        const [semanticResults, arxivResponse, suggestions] = await Promise.all([
            searchSemanticScholar(prompt),
            searchArXiv(prompt),
            getAISuggestions(prompt)
        ]);

        const processedSemantic = await Promise.all(
            semanticResults.map(async paper => ({
                title: paper.title,
                authors: paper.authors?.map(a => a.name) || [],
                abstract: paper.abstract,
                year: paper.year,
                doi: paper.doi,
                source: 'Semantic Scholar',
                metadata: await getCrossrefMetadata(paper.doi)
            }))
        );

        const processedArXiv = arxivResponse.parsed.map(entry => ({
            title: entry.title?.[0] || 'Untitled',
            authors: entry.author?.map(a => a.name?.[0]) || [],
            abstract: entry.summary?.[0]?.trim() || '',
            year: entry.published?.[0] ? new Date(entry.published[0]).getFullYear() : null,
            doi: entry.id?.[0],
            source: 'arXiv',
            metadata: null
        }));

        const allResults = [...processedSemantic, ...processedArXiv];
        const summary = allResults.length > 0 
            ? await getAISummary(allResults.map(p => `${p.title}\n${p.abstract}`).join('\n\n'))
            : 'No papers found to summarize';

        res.json({
            success: true,
            results: allResults,
            summary,
            suggestions,
            rawData: {
                arxiv: arxivResponse.raw,
                semantic: semanticResults,
                crossref: processedSemantic.map(p => p.metadata)
            }
        });

    } catch (error) {
        console.error('Server Error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Global Error:', err);
    res.status(500).json({
        success: false,
        error: 'An unexpected error occurred',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${port}`);
});
