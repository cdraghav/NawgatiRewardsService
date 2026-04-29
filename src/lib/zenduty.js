export const zendutyRequest = async (payload) => {
    if (!process.env.ZENDUTY_URL || !process.env.ZENDUTY_KEY){
        console.error('ZENDUTY URL or KEY is not set in environment variables');
        return null;
    }
    let zendutyKey = process.env.ZENDUTY_KEY;
    try {
        const response = await axios({
            url: `${process.env.ZENDUTY_URL}${zendutyKey}/`,
            method: 'post',
            headers: { 'Content-Type': 'application/json' },
            data: payload,
        });
        return response;
    } catch (error) {
        console.error(`Zenduty API call failed: ${error.message}`);
        throw error;
    }
};