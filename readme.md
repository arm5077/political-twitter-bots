#Political bot detector

Created for this story in the Atlantic: [Have Twitter Bots Infiltrated the 2016 Election?](http://www.theatlantic.com/politics/archive/2016/06/have-twitter-bots-infiltrated-the-2016-election/484964/)

This Node script uses the Twitter streaming API to monitor Hillary Clinton, Bernie Sanders and Donald Trump's tweet activity. It explicitly filters for retweets of these three candidates' posts by third parties.

Out of this population, the script samples a smaller proportion to run through [BotOrNot](http://truthy.indiana.edu/botornot/), a classifier created by folks at Indiana University. The results (along with every recorded retweet) are stored in a MySQL database.

To run this, you'll need to register an app with Twitter and store your credentials (`consumer_key`, `consumer_secret`, `access_token_key` and `access_token_secret`) as environmental variables. You'll also need a MySQL database; the script is currently configured to run either on a ClearDB instance or an instance running on your local machine. The table schema and initialization is in `init.sql` (sorry, didn't include it in the main script!).

Once you're set up, run the script with `node scrape.js`.