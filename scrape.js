var Twitter = require('twitter');
var mysql = require('mysql');
var async = require('async');
var request = require('request');
var mysql = require('mysql');

var ids_to_candidates = {'25073877': 'realdonaldtrump', '1339835893': 'hillaryclinton', '216776631': 'berniesanders'},
	candidates = ['realdonaldtrump', 'hillaryclinton', 'berniesanders'],
	candidate_ids = ['25073877', '1339835893', '216776631'],
	ids_string = candidate_ids.join(','),
	max_queries = 150,
	already_tested = [], 
	botOrNotQueue = [];

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
	console.log(err);
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
//				console.log("@" + tweet.user.screen_name + " retweeted " + tweet.retweeted_status.user.screen_name);
				
				// Record log of retweet
				pool.query("INSERT INTO tweets (candidate_id, user_id, tweet_id) VALUES (?,?,?)", 
					[tweet.retweeted_status.user.id_str, tweet.user.id_str, tweet.id_str], 
				function(err){ if(err) throw err });
			
//				console.log("max_queries=" + max_queries)
				
				// Check if we've already tested this username for botness AND if we have room in the queue
				if( already_tested.indexOf(tweet.user.screen_name) == -1 && max_queries <= 50){
					max_queries--;
					
//					console.log(tweet.user.screen_name + " hasn't been screened yet...")
					
					async.waterfall([
						// Get user statuses
						function(callback){
							client.get('statuses/user_timeline', {  
								screen_name: tweet.user.screen_name,
								count: 200
							}, function(err, tweets, response){
								if( err ) {
									console.log(err)
									throw err;
								}
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
								if( err ) throw err
								var output = tweets.concat(other_tweets.statuses);
								callback(null, output);
							});
						}], function(err, output){
							// Submit object to the queue
//							console.log("Submitting " + tweet.user.screen_name + " to the BotOrNot queue...")
							botOrNotQueue.push({ output: output, tweet: tweet  });
					})
				}
			}
		}
	});
	
	// Submit a new request to BotOrNot every five seconds
	setInterval(function(){
		 
		if( botOrNotQueue.length > 0 ){
			console.log("Queue length: " + botOrNotQueue.length);
			var test = botOrNotQueue[0];
			botOrNotQueue.splice(0,1);

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

					// debug
					if(body.score == null){
						console.log("No body...")
						console.log(body);
					}
					else {
						console.log("User string: " + test.tweet.user.id_str);
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
				console.log("Uploaded " + test.tweet.user.screen_name + " with score of " + body.score + "!")
			});
		}
	
	}, 10000);
	
	stream.on('error', function(error) {
	  throw error;
	});
	
});

/*





*/