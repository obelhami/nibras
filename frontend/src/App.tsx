import { useEffect, useState } from 'react'

function App() {
    const [message, setMessage] = useState('Loading...')

    useEffect(() => {
        fetch('http://localhost:3000/api/hello')
            .then(res => res.json())
            .then(data => {
                setMessage(data.message)
            })
    }, [])

    return (
        <div>
            <h1>{message}</h1>
        </div>
    )
}

export default App