import axios from 'axios';
import { load } from 'cheerio';
import robotsParser from 'robots-parser';
import { parentPort } from 'worker_threads';

// Database config file
import pool from './db.cjs';

const visited = new Array();  // Keep previous pages
const queue = []; // Queue list
// LIMIT REQUESTS / SEC
const MAX_REQUESTS_PER_SECOND = 5;
let requestCount = 0;

const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 10; Pixel 4 XL Build/QD1A.190821.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/91.0.864.59 Safari/537.36'
];

const getRandomUserAgent = () => {
    const randomIndex = Math.floor(Math.random() * userAgents.length);
    return userAgents[randomIndex];
}

const isAllowed = async (url) => {
    try {
        const robotsUrl = new URL('/robots.txt', url).href;
        const { data } = await axios.get(robotsUrl);

        const robot = robotsParser(robotsUrl, data);
        return robot.isAllowed(url, getRandomUserAgent());
    } catch (error) {
        parentPort.postMessage(`Error while fetching robots.txt : ${error.message}`);
        return true;
    }
}

const crawlDelay = async (url) => {
    try {
        const robotsUrl = new URL('/robots.txt', url).href;
        const { data } = await axios.get(robotsUrl);

        const robot = robotsParser(robotsUrl, data);
        return robot.getCrawlDelay(url, getRandomUserAgent());
    } catch (error) {
        parentPort.postMessage(`Error while fetching robots.txt : ${error.message}`);
        return 1000 / MAX_REQUESTS_PER_SECOND;
    }
}

const saveToDatabase = async (scraped) => {
    const client = await pool.connect();

    try {
        const insertQuery = `
            INSERT INTO scraped_data(
                name, 
                description, 
                icons, 
                openGraph, 
                url, 
                canonical, 
                alternates, 
                links, 
                text, 
                images, 
                response_time
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id;
        `;

        const result = await client.query(insertQuery, [
            scraped.name,
            scraped.description,
            JSON.stringify(scraped.icons),
            JSON.stringify(scraped.openGraph),
            scraped.url,
            scraped.canonical,
            JSON.stringify(scraped.alternates),
            JSON.stringify(scraped.links),
            JSON.stringify(scraped.text),
            JSON.stringify(scraped.images),
            scraped.responseTime,
        ]);

        parentPort.postMessage(`Added \'${scraped.url}\' to database`);
    } catch (error) {
        parentPort.postMessage('Error saving to database:', error);
    } finally {
        client.release();
    }
}

// UPDATE VISITED CONSTANT
const loadVisitedUrls = async () => {
    const client = await pool.connect();

    try {
        const result = await client.query('SELECT url FROM scraped_data');
        result.rows.forEach(row => {
            visited.push(row.url);
        });

        parentPort.postMessage(`Loaded ${result.rows.length} visited URLs from the database.`);
    } catch (error) {
        parentPort.postMessage(`Error while loading visited URLs from database : ${error.message}`);
    } finally {
        client.release();
    }
};

// QUEUE (WITH DATABASE)
const getUrlFromQueue = async () => {
    const client = await pool.connect();

    try {
        const result = await client.query('SELECT * FROM url_queue ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED');
        if (result.rows.length === 0) {
            parentPort.postMessage(`Warning - No URLs in queue.`);
            return null;
        }

        const url = result.rows[0].url;

        await client.query('DELETE FROM url_queue WHERE id = $1', [result.rows[0].id]); // -- Delete URL from queue
        // -- Remove URL from queue (local variable)
        const index = queue.findIndex(item => item.url === result.rows[0].url);
        if (index !== -1) {
            queue.splice(index, 1);
        }

        return url;
    } catch (error) {
        parentPort.postMessage(`Error getting URL from queue : ${error.message}`);
        return null;
    } finally {
        client.release();
    }
};

const addUrlToQueue = async (url) => {
    const client = await pool.connect();

    try {
        await client.query('INSERT INTO url_queue(url) VALUES ($1)', [url]); // -- Add to SQL table
        queue.push(url); // -- Add to local variable
    } catch (error) {
        parentPort.postMessage(`Error adding URL to queue : ${error.message}`);
    } finally {
        client.release();
    }
};

// MAIN FUNCTION - CRAWL URL
const crawl = async (url) => {
    // BEFORE CRAWLING THE PAGE
    // -- Check robots.txt
    if (!(await isAllowed(url))) {
        parentPort.postMessage(`Blocked by robots.txt : ${url}`);
        return;
    }
    
    // -- Start crawling
    if (visited.includes(url)) return;

    parentPort.postMessage(`Visiting : ${url}`);

    const userAgent = getRandomUserAgent();
    const startTime = Date.now(); // -- This is to measure response time (in ms)

    try {
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': userAgent
            }
        });

        const $ = load(data); // -- Load page content

        var icons = [];
        var alternates = [];
        var links = [];
        var images = [];

        // -- Response time
        const endTime = Date.now();
        const responseTime = endTime - startTime;

        // -- Get <link rel="icon"> HTML Head element
        $('link[rel*="icon"]').each((index, element) => {
            const link = $(element).attr('href');
            const type = $(element).attr('type') || '';
            const sizes = $(element).attr('sizes') || '';
            if (link) {
                if(!link.startsWith('http') && link.startsWith('/') && !link.startsWith('//')){
                    icons.push({ link: "https://" + new URL(url).hostname + link, type, sizes });
                }else if(!link.startsWith('http') && !link.startsWith('/') && !link.startsWith('//')){
                    icons.push({ link: "https://" + new URL(url).hostname + '/' + link, type, sizes });
                }else if(!link.startsWith('http') && !link.startsWith('/') && link.startsWith('//')){
                    icons.push({ link: 'https:' + link, type: '', sizes: '' });
                }else{
                    icons.push({ link, type, sizes });
                }
            }
        });

        // -- Get <link rel="apple-touch-icon"> HTML Head element
        $('link[rel="apple-touch-icon"]').each((index, element) => {
            const link = $(element).attr('href');
            if (link) {
                if(!link.startsWith('http') && link.startsWith('/') && !link.startsWith('//')){
                    icons.unshift({ link: "https://" + new URL(url).hostname + link, type: '', sizes: '' });
                }else if(!link.startsWith('http') && !link.startsWith('/') && !link.startsWith('//')){
                    icons.unshift({ link: "https://" + new URL(url).hostname + '/' + link, type: '', sizes: '' });
                }else if(!link.startsWith('http') && !link.startsWith('/') && link.startsWith('//')){
                    icons.unshift({ link: 'https:' + link, type: '', sizes: '' });
                }else{
                    icons.unshift({ link, type: '', sizes: '' });
                }
            }
        });

        // -- Get <link rel="apple-touch-icon-precomposed"> HTML Head element
        $('link[rel="apple-touch-icon-precomposed"]').each((index, element) => {
            const link = $(element).attr('href');
            if (link) {
                if(!link.startsWith('http') && link.startsWith('/') && !link.startsWith('//')){
                    icons.unshift({ link: "https://" + new URL(url).hostname + link, type: '', sizes: '' });
                }else if(!link.startsWith('http') && !link.startsWith('/') && !link.startsWith('//')){
                    icons.unshift({ link: "https://" + new URL(url).hostname + '/' + link, type: '', sizes: '' });
                }else if(!link.startsWith('http') && !link.startsWith('/') && link.startsWith('//')){
                    icons.unshift({ link: 'https:' + link, type: '', sizes: '' });
                }else{
                    icons.unshift({ link, type: '', sizes: '' });
                }
            }
        });

        // -- Get <link rel="alternate"> HTML Head element
        $('link[rel="alternate"]').each((index, element) => {
            const link = $(element).attr('href');
            const locale = $(element).attr('hreflang') || '';
            if (link && link.startsWith('http')) {
                alternates.push({ link, locale });
            }
        });

        // -- Get <a> HTML element
        $('a').each((index, element) => {
            const link = $(element).attr('href');
            if (link && link.startsWith('http') && !visited.includes(link)) {
                links.push(link);
            }
        });

        // -- Get <img> HTML element
        $('img').each((index, element) => {
            const source = $(element).attr('src');
            const alt = $(element).attr('alt') || '';
            const title = $(element).attr('title') || '';
            if (source) {
                images.push({ source, alt, title });
            }
        });

        // -- Final push
        visited.push(url);
        const scraped = {
            name: $('title').first().text().trim() || '',
            description: $('meta[name="description"]').attr('content') || $('meta[name="Description"]').attr('content') || '',
            icons,
            // -- OpenGraph tags
            openGraph: {
                title: $('meta[property="og:title"]').attr('content') || '',
                description: $('meta[property="og:description"]').attr('content') || '',
                image: $('meta[property="og:image"]').attr('content') || '',
                url: $('meta[property="og:url"]').attr('content') || '',
                type: $('meta[property="og:type"]').attr('content') || '',
                site_name: $('meta[property="og:site_name"]').attr('content') || ''
            },
            // -- URL
            url,
            // -- Canonical URL (e.g: https://www.apple.com)
            canonical: $('link[rel="canonical"]').attr('href'),
            // -- Alternates URL (e.g: https://www.apple.com/fr/)
            alternates,
            // -- Links on the page
            links,
            // -- Get page content (text content
            text: $('p, h1, h2, h3, h4, h5, h6, li').map((_, el) => $(el).text().trim()).get(),
            // -- Get all images
            images,
            // -- Get calculated response time
            responseTime,
        };

        // Save this to db
        saveToDatabase(scraped);

        // When this page is entirely stored, queued another (from a link of this page)
        links.forEach(async (link) => {
            if (!visited.includes(link) && !queue.includes(link)) {
                await addUrlToQueue(link);
            }
        });
    } catch (error) {
        parentPort.postMessage( `Error while fetching web page : ${error.message}`);
    }
}

// ...
let inProgress = false;
let queueRunning = false;
let visitedUrlsLoaded = false;

export const initialize = async () => {
    await loadVisitedUrls();
    visitedUrlsLoaded = true;

    processQueue();
};

const processQueue = async () => {
    if (queueRunning) return;
    queueRunning = true;

    // Verify already verified URLs
    if (!visitedUrlsLoaded) {
        parentPort.postMessage('Error - Visited URLs not loaded yet.');
        setTimeout(processQueue, 100);
        return;
    }

    if (requestCount < MAX_REQUESTS_PER_SECOND) {
        const nextUrl = await getUrlFromQueue();
        if (nextUrl) {
            inProgress = true;
            crawlDelay(nextUrl).then(delay => {
                delay = delay || 1000 / MAX_REQUESTS_PER_SECOND;

                requestCount++;
                crawl(nextUrl).finally(() => {
                    requestCount--;
                    inProgress = false;
                });

                setTimeout(processQueue, delay);
            }).catch(error => {
                parentPort.postMessage(`Error in crawl-delay: ${error.message}`);
                inProgress = false;
                setTimeout(processQueue, 100);
            });
        }
    } else {
        setTimeout(processQueue, 100);
    }

    queueRunning = false;
};

// Remove these comments if you haven't explored or stored any URLs.
// This is a startup URL, which you must delete to avoid exploring the same page every
// time you run the script.
// 
// addUrlToQueue('https://www.speedtest.net/'); // Push first URL (choose whatever you want)

initialize(); // Start script