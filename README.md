# Web Crawler

This project is a **web crawler** developed in **JavaScript** with **Node.js**. It can crawl a website, retrieve information (such as links, page titles, etc.) and store it for later analysis.
This crawler have a queue system combined to a worker system to retrieve information more effeciently and quickly.

## Features

- Worker system for faster scraping of URLs stored in the queue
- Tracking of pages visited to avoid repeat visits
- Storage of retrieved data in a PostgreSQL database
- Queue system stored on a database (different table from the one containing the scraped data)
- Robots.txt file compliance
- Several predefined User-Agents to prevent the bot from being blocked

## Requirements

Make sure you have the following installed on your computer:

- **Node.js** (version 20 ou higher)
- **npm** (or yarn)

## Installation

1. Clone this repository :
```bash
git clone https://github.com/Climoux/web-crawler.git
```

2. Go to the project directory :
```bash
cd web-crawler
```

3. Install dependencies :
```sh
npm install
# or
pnpm install
# or
yarn install
```

## Usage

1. Create the database and the two tables to store queued URLs and scraped data.
> The default names for the tables are :
> - `scraped_data`
> - `url_queue`

2. Create a `.env` file to store your credentials.
```env
DB_USER=your_user
DB_PASSWORD=your_password
DB_DATABASE=your_database
```

2. Check number of workers. (default: 5)
> To begin - choose a single worker to avoid errors in the queue. Once this first worker has queued several URLs, you can add more workers.

3. Check the starting URL in the `worker.js` file. You can choose any URL to get started :
```js
addUrlToQueue('CHOOSE_YOUR_URL');
```
> After your first start, you can comment out this line, to avoid visiting the URL every time you run the crawler.

4. Run the crawler using the following command:
```sh
npm run start
# or
pnpm run start
```

## Database structure

Data structure for the `scraped_data` table :
> - id
> - [... same as output example]
> - created_at : entry creation date (`DATETIME`)

For the `url_queue` table :
> - id
> - url
> - created_at : entry creation date (`DATETIME`)

## Output example

After running the crawler, the results are stored in a database.
Here is the default crawl output :
```json
{
  "name": "Output example - Website",
  "description": "This is an output example.",
  "icons": [
    {
      "link": "https://example.com/static/icon.png",
      "type": "image/png",
      "sizes": "32x32"
    }
  ],
  "openGraph": {
    "title": "Output example - Website",
    "description": "This is an output example.",
    "image": "",
    "url": "https://example.com",
    "type": "website",
    "site_name": "Website"
  },
  "url": "https://example.com",
  "canonical": "https://example.com",
  "alternates": [
    { "https://fr.example.com" }
  ],
  "links": [],
  "text": [],
  "images": [],
  "responseTime": "800",
}
```

## Contribute

Contributions are welcome! If you have an idea or feature you'd like to add, open a **issue** or submit a **pull request**.
Before submitting a PR, please make sure that the tests have been passed and that the modifications do not break anything existing.

## Licence

This project is licensed under the **BSD-3-Clause** license. See the LICENSE file for more details.
