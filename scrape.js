var Twitter = require('twitter');
var mysql = require('mysql');
var async = require('async');
var request = require('request');
var mysql = require('mysql');

var candidates = ['realdonaldtrump', 'hillaryclinton', 'berniesanders'],
	candidate_ids = ['25073877', '1339835893', '216776631'],
	ids_string = candidate_ids.join(','),
	max_queries = 150,
	already_tested = [], 
	bot_or_not_queue = [], 
	rest_period = false;

// Initialize Twitter client
var client = new Twitter({
	consumer_key: process.env.consumer_key,
	consumer_secret: process.env.consumer_secret,
	access_token_key: process.env.access_token_key,
	access_token_secret: process.env.access_token_secret
})

// Start MySQL 
var pool = mysql.createPool((process.env.CLEARDB_DATABASE_URL || "mysql://root@localhost/bots"));
pool.on("error", function(err){
	throw err;
	pool.end();
});

// Start 15 minute timer to refresh API rate limit
setInterval(function(){ max_queries = 150 }, 1000 * 60 * 15);

// Grab tweets involving the three candidates
client.stream('statuses/filter', {follow: ids_string}, function(stream) {
	stream.on('data', function(tweet) {
		
		// Is this a retweet?
		if(tweet.retweeted_status){
			// Is it actually a retweet of a candidate's tweet?
			if(candidates.indexOf(tweet.retweeted_status.user.screen_name.toLowerCase()) != -1){
				
				// Record log of retweet
				pool.query("INSERT INTO tweets (candidate_id, user_id, tweet_id) VALUES (?,?,?)", 
					[tweet.retweeted_status.user.id_str, tweet.user.id_str, tweet.id_str], 
				function(err){ if(err) throw err });
				
				// Check if we've already tested this username for botness AND if we have room in the queue
				// (Tweet objects are actually pretty largee and fill up memory fast on the free Heroku instance)
				if( already_tested.indexOf(tweet.user.screen_name) == -1 && bot_or_not_queue.length <= 50 && max_queries > 0){
					max_queries--;
					
					// Capture information BotOrNot needs about this user
					async.waterfall([
						// Get user statuses
						function(callback){
							client.get('statuses/user_timeline', {  
								screen_name: tweet.user.screen_name,
								count: 200
							}, function(err, tweets, response){
								if(err) throw err;
								callback(null, tweets)
							});
						},
						// Get tweets about user
						function(tweets, callback){
							client.get('search/tweets', {
								q: "@" + tweet.user.screen_name,
								result_type: "recent",
								count: 100
							}, function(err, other_tweets, response){
								if(err) throw err
								var output = tweets.concat(other_tweets.statuses);
								callback(null, output);
							});
						}], function(err, output){
							// Submit object to the queue
//							console.log("Submitting " + tweet.user.screen_name + " to the BotOrNot queue...")
							bot_or_not_queue.push({ output: output, tweet: tweet  });
					})
				}
			}
		}
	});
	
	// Submit a new request to BotOrNot every ten seconds
	setInterval(function(){
		// Is there something in the queue to test? And are we in a don't-overwhelm-the-servers rest period?
		if( bot_or_not_queue.length > 0 && rest_period==false ){
			console.log("Queue length: " + bot_or_not_queue.length);
			var test = bot_or_not_queue[0];
			bot_or_not_queue.splice(0,1);

			// Submit information to BotOrNot
			async.waterfall([
				function(callback){
					request({
						url: 'http://truthy.indiana.edu/botornot/api/bot_detect/',
						timeout: 30000,
						method: 'post',
						json: true,
						body: {
							content: test.output,
							meta: {
								user_id: test.tweet.user.id_str,
								screen_name: test.tweet.user.screen_name
							} 
						},
					}, function(err, response, body){
						if(err) throw err;	
						callback(null, body)
					})
				},
				// Store user information in database
				function(body, callback){

					// Still have to debug this weird server error; for now just rest for 30 seconds
					if(body.score == null){
						console.log("No body after trying " + test.tweet.user.screen_name + "... resting for 30 seconds minutes")
						console.log("The error: \n" + body)
						rest_period = true;
						setTimeout(function(){ rest_period = false }, 1000 * 30)
						callback();
					}
					else {
						
						// Store user bot score in database
						pool.query("INSERT INTO tested_users (user_id, score, candidate_id) VALUES (?, ?, ?)", 
							[test.tweet.user.id_str, body.score, test.tweet.retweeted_status.user.id_str], 
						function(err){ 
							if(err) throw err; 
							callback(null, body);
						});
					}
				}	
			], function(err, body){ 
				if(err) throw err; 
				
				// Expects a body object, but if the server error happened, display nothing
				if( body != null )
					console.log("Uploaded " + test.tweet.user.screen_name + " with score of " + body.score + "!")
			});
		}
	}, 10000);
	
	stream.on('error', function(error) {
	  throw error;
	});
	
});