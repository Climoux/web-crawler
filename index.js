import { styleText } from 'node:util';
import { Worker } from 'worker_threads';

const numWorkers = 5;

function formatMessage(message) {
    const styles = [
        { regex: /\b(Error|Blocked)\b/i, color: 'red' }, // "Error" / "Blocked" -> red
        { regex: /\bWarning\b/i, color: 'yellow' }, // "Warning" -> yellow
        { regex: /\b(Loaded|Visiting|Added)\b/i, color: 'green' } // "Loaded" / "Visiting" / "Added" -> green
    ];

    for (let style of styles) {
        if (style.regex.test(message)) {
            const match = message.match(style.regex)[0];
            return message.replace(match, styleText(style.color, match));
        }
    }

    return message;
}

for (let i = 0; i < numWorkers; i++) {
    const worker = new Worker('./worker.js');

    worker.on('message', (msg) => {
        console.log(`Worker ${worker.threadId}:`, formatMessage(msg));
    });

    worker.on('exit', (code) => {
        console.log(styleText('red', `Worker ${worker.threadId} exited with code ${code}`));
    });
}
