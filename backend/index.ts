import { Elysia} from 'elysia';
import { cors } from '@elysiajs/cors';

const app  = new Elysia();

app.use(cors());

app.get('/', () => {
    return 'Hello World';
});


app.get('/api/hello', () => {
    return {
        message: 'Hello from Elysia Backend'
    }
})

app.listen(3000);

console.log('Elysia server is running on http://localhost:3000');